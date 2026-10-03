import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { SendNotificationUseCase } from '../use-case/send-notification.use-case';

interface PrescriptionIssuedPayload {
  prescriptionId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  issuedAt: string;
  issuedBy: string;
}

@Injectable()
export class PrescriptionNotificationConsumer {
  private readonly logger = new Logger(PrescriptionNotificationConsumer.name);

  constructor(
    private readonly sendNotification: SendNotificationUseCase,
    @InjectRepository(ProcessedEventEntity)
    private readonly processed: Repository<ProcessedEventEntity>,
  ) {}

  @RabbitSubscribe({
    exchange: 'appointment_exchange',
    routingKey: 'PRESCRIPTION_ISSUED',
    queue: 'prescription_notification_queue',
    queueOptions: {
      arguments: {
        'x-dead-letter-exchange': 'appointment_exchange.dlx',
        'x-dead-letter-routing-key': 'PRESCRIPTION_ISSUED.dead',
      },
    },
  })
  async handleIssued(msg: PrescriptionIssuedPayload, amqpMsg: ConsumeMessage) {
    const eventId = amqpMsg?.properties?.headers?.['x-event-id'] as string | undefined;

    if (eventId) {
      try {
        await this.processed.insert({ eventId, eventType: 'PRESCRIPTION_ISSUED' });
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') {
          this.logger.warn(`[Idempotency] Event ${eventId} already processed — skipping duplicate notification.`);
          return;
        }
        this.logger.error(`Prescription claim insert failed for event ${eventId}: ${(err as Error).message}`);
        return new Nack(false);
      }
    }

    try {
      await this.sendNotification.execute({
        userId: msg.patientId,
        title: 'Prescription ready',
        message: 'Your prescription is ready for download',
      });
      this.logger.log(`Prescription notification created for user ${msg.patientId}`);
    } catch (err) {
      this.logger.error(`Prescription notification failed for ${msg.patientId}/${msg.prescriptionId}: ${(err as Error).message}`);
      return new Nack(false);
    }
  }

  @RabbitSubscribe({
    exchange: 'appointment_exchange.dlx',
    routingKey: 'PRESCRIPTION_ISSUED.dead',
    queue: 'prescription_notification_queue.dlq',
  })
  async handleDeadLetter(msg: unknown, amqpMsg: ConsumeMessage) {
    const deathHeader = amqpMsg?.properties?.headers?.['x-death'];
    this.logger.error(`[DLQ Alert] Prescription event landed in DLQ! Payload: ${JSON.stringify(msg)}`);
    this.logger.error(`[DLQ Details] Death info: ${JSON.stringify(deathHeader)}`);
  }
}
