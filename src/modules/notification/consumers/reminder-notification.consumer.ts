import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { AppointmentMailService } from 'src/common/mail/appointment-mail.service';
import { UserEntity } from 'src/modules/auth/entities/user.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { ClinicEntity } from 'src/modules/catalog/entities/clinic.entity';
import { NotificationEntity } from '../entities/notification.entity';

interface ReminderDuePayload {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  startTime: string;
  reminderId: string;
}

const CONSUMER_SUFFIX = 'reminder-email';

@Injectable()
export class ReminderNotificationConsumer {
  private readonly logger = new Logger(ReminderNotificationConsumer.name);

  constructor(
    private readonly appointmentMailService: AppointmentMailService,
    @InjectRepository(ProcessedEventEntity)
    private readonly processedEvents: Repository<ProcessedEventEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(DoctorEntity)
    private readonly doctorRepo: Repository<DoctorEntity>,
    @InjectRepository(ClinicEntity)
    private readonly clinicRepo: Repository<ClinicEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
  ) {}

  @RabbitSubscribe({
    exchange: 'appointment_exchange',
    routingKey: 'REMINDER_DUE',
    queue: 'reminder_due_notification_queue',
    queueOptions: {
      arguments: {
        'x-dead-letter-exchange': 'appointment_exchange.dlx',
        'x-dead-letter-routing-key': 'REMINDER_DUE.dead',
      },
    },
  })
  public async handleReminderDue(msg: ReminderDuePayload, amqpMsg: ConsumeMessage) {
    const rawEventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;
    const eventKey = rawEventId ? `${rawEventId}:${CONSUMER_SUFFIX}` : undefined;

    if (eventKey) {
      const already = await this.processedEvents.findOne({ where: { eventId: eventKey } });
      if (already) return;
    }

    try {
      const user = await this.userRepo.findOne({ where: { id: msg.patientId } });

      if (!user || !user.email) {
        return new Nack(false);
      }

      const [doctor, clinic] = await Promise.all([
        this.doctorRepo.findOne({ where: { id: msg.doctorId } }),
        this.clinicRepo.findOne({ where: { id: msg.clinicId } }),
      ]);

      await this.appointmentMailService.sendBookingConfirmation(user.email, {
        doctorName: doctor?.fullName,
        clinicName: clinic?.name,
        date: msg.date,
        startTime: msg.startTime,
        instructions: 'Please arrive 15 minutes before the appointment.',
      });

      const row = this.notificationRepo.create({
        userId: user.id,
        title: 'Appointment reminder',
        message: `Reminder: You have an appointment on ${msg.date} at ${msg.startTime}. Please arrive 15 minutes early.`,
        isRead: false,
      });
      await this.notificationRepo.save(row);

      if (eventKey) {
        try {
          await this.processedEvents.insert({
            eventId: eventKey,
            eventType: 'REMINDER_DUE',
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
      this.logger.error(`Reminder delivery failed for ${msg.appointmentId}: ${reason}`);
      return new Nack(false);
    }
  }

  @RabbitSubscribe({
    exchange: 'appointment_exchange.dlx',
    routingKey: 'REMINDER_DUE.dead',
    queue: 'reminder_due_notification_queue.dlq',
  })
  public async handleDeadLetter(msg: unknown, amqpMsg: ConsumeMessage) {
    const deathHeader = amqpMsg.properties.headers?.['x-death'];
    this.logger.error(`[DLQ Alert] Reminder email event landed in DLQ! Payload:`, msg as object);
    this.logger.error(`[DLQ Details] Death info:`, deathHeader as object);
  }
}
