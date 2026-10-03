import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
    AppointmentEntity,
    AppointmentStatus,
    CancellationOutcome,
} from 'src/modules/catalog/entities/appointment.entity';
import { RefundService } from 'src/modules/payment/services/refund.service';
import { CancellationDecision, decideCancellation } from '../policies/cancellation-policy';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { CancelAppointmentResponseDto } from '../dto/cancel-appointment.dto';
import { getAppointmentStart } from '../helpers/appiontment-time';
import { AppointmentReminderService } from '../services/appointment-reminder.service';

const FREE_MESSAGE = 'Cancelled successfully! No fees will be charged.';
const NO_REFUND_MESSAGE =
    'Appointment cancelled! No refund available as cancellation was made less than 24 hours before the scheduled time.';

@Injectable()
export class CancelAppointmentUseCase {
    private readonly logger = new Logger(CancelAppointmentUseCase.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly refundService: RefundService,
        private readonly reminderService: AppointmentReminderService,
    ) { }

    async execute(
        appointmentId: string,
        patientId: string,
        acknowledgedOutcome?: CancellationOutcome,
    ): Promise<CancelAppointmentResponseDto> {
        const { response, refundId } = await this.dataSource.transaction(async (manager) => {
            const appointment = await manager
                .getRepository(AppointmentEntity)
                .createQueryBuilder('app')
                .setLock('pessimistic_write')
                .where('app.id = :id', { id: appointmentId })
                .getOne();

            if (!appointment || appointment.patientId !== patientId) {
                throw new NotFoundException('Appointment not found');
            }

            if (appointment.status === AppointmentStatus.CANCELLED) {
                throw new BadRequestException('Appointment is already cancelled');
            }
            if (appointment.status === AppointmentStatus.COMPLETED) {
                throw new BadRequestException('Cannot cancel a completed appointment');
            }

            const now = new Date();
            const decision = decideCancellation(getAppointmentStart(appointment), now);

            if (decision === CancellationDecision.ALREADY_STARTED) {
                throw new BadRequestException('Cannot cancel an appointment that has already started');
            }

            const outcome =
                decision === CancellationDecision.FREE
                    ? CancellationOutcome.FREE
                    : CancellationOutcome.NO_REFUND;

            if (acknowledgedOutcome && acknowledgedOutcome !== outcome) {
                throw new ConflictException({
                    code: 'OUTCOME_CHANGED',
                    message: 'The cancellation terms changed. Please review and confirm again.',
                    outcome,
                    previousOutcome: acknowledgedOutcome,
                });
            }

            appointment.status = AppointmentStatus.CANCELLED;
            appointment.cancelledAt = now;
            appointment.cancellationOutcome = outcome;
            await manager.getRepository(AppointmentEntity).save(appointment);

            await this.reminderService.cancelForAppointment(manager, appointment.id);

            let refundStatus: 'NOT_APPLICABLE' | 'PENDING' = 'NOT_APPLICABLE';
            let refundId: string | null = null;

            if (outcome === CancellationOutcome.FREE) {
                if (appointment.holdId) {
                    const refund = await this.refundService.createPendingRefund(manager, {
                        appointmentId: appointment.id,
                        holdId: appointment.holdId,
                    });
                    refundId = refund.id;
                    refundStatus = 'PENDING';
                } else {
                    this.logger.warn(
                        `Appointment ${appointment.id} cancelled free but has no holdId: no refund created`,
                    );
                }
            }

            await manager.getRepository(OutboxEventEntity).save({
                aggregateType: 'APPOINTMENT',
                aggregateId: appointment.id,
                exchange: 'appointment_exchange',
                eventType: 'APPOINTMENT_CANCELLED',
                payload: {
                    appointmentId: appointment.id,
                    patientId: appointment.patientId,
                    doctorId: appointment.doctorId,
                    clinicId: appointment.clinicId,
                    holdId: appointment.holdId,
                    date: appointment.date,
                    startTime: appointment.startTime,
                    cancelledAt: now,
                    cancellationOutcome: outcome,
                },
            });

            return {
                refundId,
                response: {
                    appointmentId: appointment.id,
                    cancelledAt: now,
                    outcome,
                    refundStatus,
                    message: outcome === CancellationOutcome.FREE ? FREE_MESSAGE : NO_REFUND_MESSAGE,
                } as CancelAppointmentResponseDto,
            };
        });

        if (refundId) {
            this.refundService.processRefund(refundId).catch((err: any) => {
                this.logger.error(`Immediate refund attempt failed for ${refundId}: ${err?.message}`);
            });
        }

        return response;
    }
}