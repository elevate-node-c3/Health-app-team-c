import { Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppointmentEntity } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from 'src/common/outbox/services/outbox-processor.service';
import { PrescriptionEntity } from '../entities/prescription.entity';
import { PRESCRIPTION_STORAGE, PrescriptionStorage } from '../prescription-storage.interface';
import { assertCompleted, detectAllowedMime, mimeToExtension } from '../policies/prescription-policy';
import { prescriptionMaxBytes } from './attach-prescription.use-case';

@Injectable()
export class ReplacePrescriptionUseCase {
  private readonly logger = new Logger(ReplacePrescriptionUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(PRESCRIPTION_STORAGE)
    private readonly storage: PrescriptionStorage,
    private readonly outboxProcessor: OutboxProcessorService,
  ) {}

  async execute(appointmentId: string, fileBuffer: Buffer, adminId: string): Promise<PrescriptionEntity> {
    if (fileBuffer.length > prescriptionMaxBytes()) {
      throw new PayloadTooLargeException({
        code: 'PRESCRIPTION_TOO_LARGE',
        messageKey: 'errors.prescription.too_large',
        message: 'Prescription file exceeds the size limit',
      });
    }

    const mime = detectAllowedMime(fileBuffer);
    if (!mime) {
      throw new UnprocessableEntityException({
        code: 'PRESCRIPTION_INVALID_TYPE',
        messageKey: 'errors.prescription.invalid_type',
        message: 'Only PDF, PNG or JPEG prescriptions are accepted',
      });
    }

    const storageKey = `${appointmentId}/${randomUUID()}.${mimeToExtension(mime)}`;
    await this.storage.save(storageKey, fileBuffer, mime);

    try {
      const { prescription, oldKey, eventId } = await this.dataSource.transaction(async (manager) => {
        const appointment = await manager
          .getRepository(AppointmentEntity)
          .createQueryBuilder('app')
          .setLock('pessimistic_write')
          .where('app.id = :id', { id: appointmentId })
          .getOne();

        if (!appointment) {
          throw new NotFoundException({
            code: 'PRESCRIPTION_APPOINTMENT_NOT_FOUND',
            messageKey: 'errors.prescription.appointment_not_found',
            message: 'Appointment not found',
          });
        }

        assertCompleted(appointment.status);

        const prescription = await manager
          .getRepository(PrescriptionEntity)
          .createQueryBuilder('p')
          .setLock('pessimistic_write')
          .where('p.appointmentId = :appointmentId', { appointmentId })
          .getOne();

        if (!prescription) {
          throw new NotFoundException({
            code: 'PRESCRIPTION_NOT_FOUND',
            messageKey: 'errors.prescription.not_found',
            message: 'No prescription exists for this appointment',
          });
        }

        const oldKey = prescription.storageKey;
        prescription.storageKey = storageKey;
        prescription.mimeType = mime;
        prescription.sizeBytes = fileBuffer.length;
        prescription.replacedBy = adminId;
        prescription.replacedAt = new Date();
        await manager.getRepository(PrescriptionEntity).save(prescription);

        const event = await manager.getRepository(OutboxEventEntity).save({
          aggregateType: 'PRESCRIPTION',
          aggregateId: prescription.id,
          exchange: 'appointment_exchange',
          eventType: 'PRESCRIPTION_ISSUED',
          payload: {
            prescriptionId: prescription.id,
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            clinicId: appointment.clinicId,
            issuedAt: prescription.replacedAt,
            issuedBy: adminId,
          },
        });

        return { prescription, oldKey, eventId: event.id };
      });

      await this.storage.delete(oldKey).catch((err: Error) => this.logger.warn(`Prescription old file cleanup failed for ${oldKey}: ${err.message}`));

      setImmediate(() => {
        this.outboxProcessor.triggerPublish(eventId).catch((err: Error) => {
          this.logger.error(`Instant outbox publish failed for event ID ${eventId}: ${err.message}`);
        });
      });

      this.logger.log(`Prescription ${prescription.id} replaced for appointment ${appointmentId} sizeBytes=${fileBuffer.length} mime=${mime}`);
      return prescription;
    } catch (err) {
      await this.storage.delete(storageKey).catch((cleanupErr: Error) => this.logger.warn(`Prescription file cleanup failed for ${storageKey}: ${cleanupErr.message}`));
      throw err;
    }
  }
}
