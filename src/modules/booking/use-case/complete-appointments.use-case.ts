import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';
import { CompletionDecision, decideCompletion } from '../policies/completion-policy';

@Injectable()
export class CompleteAppointmentsUseCase {
  private readonly logger = new Logger(CompleteAppointmentsUseCase.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async execute(now: Date = new Date()): Promise<number> {
    let claimedIds: string[] = [];

    try {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM appointments WHERE status = 'BOOKED' ORDER BY date ASC, "startTime" ASC LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      claimedIds = rows.map((r) => r.id);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Completion claim failed: ${reason}`);
      return 0;
    }

    if (claimedIds.length === 0) return 0;

    let processed = 0;

    for (const id of claimedIds) {
      try {
        const didProcess = await this.dataSource.transaction(async (manager) => {
          const appointment = await manager
            .getRepository(AppointmentEntity)
            .createQueryBuilder('app')
            .setLock('pessimistic_write')
            .where('app.id = :id', { id })
            .getOne();

          if (!appointment || appointment.status !== AppointmentStatus.BOOKED) return false;

          const decision = decideCompletion(getAppointmentStart(appointment), now);
          if (decision === CompletionDecision.NOT_DUE) return false;

          const eventType =
            decision === CompletionDecision.COMPLETED
              ? 'APPOINTMENT_COMPLETED'
              : 'APPOINTMENT_NO_SHOW';

          if (decision === CompletionDecision.COMPLETED) {
            appointment.status = AppointmentStatus.COMPLETED;
            appointment.completedAt = now;
          } else {
            appointment.status = AppointmentStatus.NO_SHOW;
            appointment.noShowAt = now;
          }

          await manager.getRepository(AppointmentEntity).save(appointment);

          await manager.getRepository(OutboxEventEntity).save({
            aggregateType: 'APPOINTMENT',
            exchange: 'appointment_exchange',
            eventType,
            payload: {
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              clinicId: appointment.clinicId,
              date: appointment.date,
              startTime: appointment.startTime,
            },
          });

          return true;
        });

        if (didProcess) {
          processed += 1;
          this.logger.log(`Appointment ${id} marked completed or no-show`);
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Complete appointment ${id} failed: ${reason}`);
      }
    }

    return processed;
  }
}
