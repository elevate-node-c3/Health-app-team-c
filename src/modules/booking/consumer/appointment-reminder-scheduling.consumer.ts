import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { AppointmentReminderService } from '../services/appointment-reminder.service';

interface AppointmentBookedPayload {
  appointmentId: string;
  patientId: string;
  userId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  startTime: string;
}

const CONSUMER_SUFFIX = 'reminder-schedule';

@Injectable()
export class AppointmentReminderSchedulingConsumer {
  private readonly logger = new Logger(AppointmentReminderSchedulingConsumer.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly reminderService: AppointmentReminderService,
    @InjectRepository(ProcessedEventEntity)
    private readonly processedEvents: Repository<ProcessedEventEntity>,
  ) {}

  @RabbitSubscribe({
    exchange: 'appointment_exchange',
    routingKey: 'APPOINTMENT_BOOKED',
    queue: 'appointment_reminder_schedule_queue',
    queueOptions: {
      arguments: {
        'x-dead-letter-exchange': 'appointment_exchange.dlx',
        'x-dead-letter-routing-key': 'APPOINTMENT_BOOKED.dead',
      },
    },
  })
  public async handleAppointmentBooked(msg: AppointmentBookedPayload, amqpMsg: ConsumeMessage) {
    const rawEventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;
    const eventKey = rawEventId ? `${rawEventId}:${CONSUMER_SUFFIX}` : undefined;

    if (eventKey) {
      const already = await this.processedEvents.findOne({ where: { eventId: eventKey } });
      if (already) return;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const patientId = msg.patientId ?? msg.userId;
        await this.reminderService.scheduleForBooking(
          manager,
          {
            appointmentId: msg.appointmentId,
            patientId,
            doctorId: msg.doctorId,
            clinicId: msg.clinicId,
            date: msg.date,
            startTime: msg.startTime,
          },
          new Date(),
        );
      });

      if (eventKey) {
        try {
          await this.processedEvents.insert({
            eventId: eventKey,
            eventType: 'APPOINTMENT_BOOKED',
          });
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code !== '23505') {
            const reason = err instanceof Error ? err.message : 'unknown error';
            this.logger.error(`Failed to record processed event ${eventKey}: ${reason}`);
          }
        }
      }

      return;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Reminder schedule failed for ${msg.appointmentId}: ${reason}`);
      return new Nack(false);
    }
  }

  @RabbitSubscribe({
    exchange: 'appointment_exchange.dlx',
    routingKey: 'APPOINTMENT_BOOKED.dead',
    queue: 'appointment_reminder_schedule_queue.dlq',
  })
  public async handleDeadLetter(msg: unknown, amqpMsg: ConsumeMessage) {
    const deathHeader = amqpMsg.properties.headers?.['x-death'];
    this.logger.error(`[DLQ Alert] Reminder schedule landed in DLQ! Payload:`, msg as object);
    this.logger.error(`[DLQ Details] Death info:`, deathHeader as object);
  }
}
