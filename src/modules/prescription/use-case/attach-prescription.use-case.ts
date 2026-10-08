import { ConflictException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AppointmentEntity } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from 'src/common/outbox/services/outbox-processor.service';
import { PrescriptionEntity } from '../entities/prescription.entity';
import { PRESCRIPTION_STORAGE, PrescriptionStorage } from '../prescription-storage.interface';
import { assertCompleted, detectAllowedMime, mimeToExtension } from '../policies/prescription-policy';

export function prescriptionMaxBytes(): number {
  const parsed = Number(process.env.PRESCRIPTION_MAX_BYTES ?? '5242880');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5242880;
}

@Injectable()
export class AttachPrescriptionUseCase {
  private readonly logger = new Logger(AttachPrescriptionUseCase.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(PRESCRIPTION_STORAGE)
    private readonly storage: PrescriptionStorage,
    private readonly outboxProcessor: OutboxProcessorService,
    @InjectRepository(PrescriptionEntity)
    private readonly prescriptions: Repository<PrescriptionEntity>,
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

    const existing = await this.prescriptions.findOne({ where: { appointmentId } });
    if (existing) {
      throw new ConflictException({
        code: 'PRESCRIPTION_ALREADY_EXISTS',
        messageKey: 'errors.prescription.already_exists',
        message: 'A prescription already exists for this appointment',
      });
    }

    const storageKey = `${appointmentId}/${randomUUID()}.${mimeToExtension(mime)}`;
    await this.storage.save(storageKey, fileBuffer, mime);

    try {
      const { prescription, eventId } = await this.dataSource.transaction(async (manager) => {
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

        const prescription = await manager.getRepository(PrescriptionEntity).save({
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          storageKey,
          mimeType: mime,
          sizeBytes: fileBuffer.length,
          uploadedBy: adminId,
          uploadedAt: new Date(),
        });

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
            issuedAt: prescription.uploadedAt,
            issuedBy: adminId,
          },
        });

        return { prescription, eventId: event.id };
      });

      setImmediate(() => {
        this.outboxProcessor.triggerPublish(eventId).catch((err: Error) => {
          this.logger.error(`Instant outbox publish failed for event ID ${eventId}: ${err.message}`);
        });
      });

      this.logger.log(`Prescription ${prescription.id} attached to appointment ${appointmentId} sizeBytes=${fileBuffer.length} mime=${mime}`);
      return prescription;
    } catch (err) {
      await this.storage.delete(storageKey).catch((cleanupErr: Error) => this.logger.warn(`Prescription file cleanup failed for ${storageKey}: ${cleanupErr.message}`));
      const code = (err as { code?: string }).code ?? (err as { driverError?: { code?: string } }).driverError?.code;
      if (code === '23505') {
        throw new ConflictException({
          code: 'PRESCRIPTION_ALREADY_EXISTS',
          messageKey: 'errors.prescription.already_exists',
          message: 'A prescription already exists for this appointment',
        });
      }
      throw err;
    }
  }
}
