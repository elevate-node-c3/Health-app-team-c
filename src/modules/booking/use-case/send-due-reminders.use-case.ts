import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AppointmentReminderEntity, ReminderStatus } from '../entities/appointment-reminder.entity';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';

@Injectable()
export class SendDueRemindersUseCase {
  private readonly logger = new Logger(SendDueRemindersUseCase.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async execute(now: Date = new Date()): Promise<number> {
    let claimedIds: string[] = [];

    try {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM appointment_reminders WHERE status = 'PENDING' AND "remindAt" <= $1 ORDER BY "remindAt" ASC LIMIT 50 FOR UPDATE SKIP LOCKED`,
        [now.toISOString()],
      );
      claimedIds = rows.map((r) => r.id);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Reminder sender claim failed: ${reason}`);
      return 0;
    }

    if (claimedIds.length === 0) return 0;

    let sent = 0;

    for (const id of claimedIds) {
      try {
        const didSend = await this.dataSource.transaction(async (manager) => {
          const reminderRepo = manager.getRepository(AppointmentReminderEntity);
          const reminder = await reminderRepo
            .createQueryBuilder('reminder')
            .setLock('pessimistic_write')
            .where('reminder.id = :id', { id })
            .getOne();

          if (!reminder || reminder.status !== ReminderStatus.PENDING) return false;

          const appointment = await manager
            .getRepository(AppointmentEntity)
            .findOne({ where: { id: reminder.appointmentId } });

          if (!appointment || appointment.status !== AppointmentStatus.BOOKED) {
            reminder.status = ReminderStatus.SKIPPED;
            await reminderRepo.save(reminder);
            return false;
          }

          const start = getAppointmentStart(appointment);
          if (start.getTime() <= now.getTime()) {
            reminder.status = ReminderStatus.SKIPPED;
            await reminderRepo.save(reminder);
            return false;
          }

          reminder.status = ReminderStatus.SENT;
          reminder.sentAt = now;
          await reminderRepo.save(reminder);

          await manager.getRepository(OutboxEventEntity).save({
            aggregateType: 'APPOINTMENT',
            exchange: 'appointment_exchange',
            eventType: 'REMINDER_DUE',
            payload: {
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              clinicId: appointment.clinicId,
              date: appointment.date,
              startTime: appointment.startTime,
              reminderId: reminder.id,
            },
          });

          return true;
        });

        if (didSend) {
          sent += 1;
          this.logger.log(`Reminder ${id} marked SENT`);
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Send reminder ${id} failed: ${reason}`);
      }
    }

    return sent;
  }
}
