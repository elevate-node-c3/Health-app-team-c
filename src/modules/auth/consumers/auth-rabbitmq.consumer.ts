import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from 'src/common/mail/mail.service';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { ConsumeMessage } from 'amqplib';

@Injectable()
export class AuthRabbitMQConsumer {
    private readonly logger = new Logger(AuthRabbitMQConsumer.name);

    constructor(
        private readonly mailService: MailService,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedEvents: Repository<ProcessedEventEntity>,
    ) { }

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'user.registered',
        queue: 'user_registration_queue',
        queueOptions: {
            arguments: {
                'x-dead-letter-exchange': 'auth_exchange.dlx',
                'x-dead-letter-routing-key': 'user.registered.dead',
            },
        },
    })
    public async handleUserRegistered(
        msg: { userId: string; email: string; otpCode: string },
        amqpMsg: ConsumeMessage,
    ) {
        const eventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;

        this.logger.log(`[RabbitMQ Consumer] Received 'user.registered' event for email: ${msg.email}`);

        // idempotency guard
        if (eventId) {
            try {
                await this.processedEvents.insert({ eventId, eventType: 'user.registered' });
            } catch {
                this.logger.warn(`[Idempotency] Event ${eventId} already processed — skipping duplicate email.`);
                return;
            }
        }

        try {
            await this.mailService.sendVerificationEmail(msg.email, msg.otpCode);
            this.logger.log(`[Email Dispatched Successfully] Verification email sent to ${msg.email}`);
            return;
        } catch (error) {
            this.logger.error(`Failed to send verification email to ${msg.email}: ${error.message}`);
            return new Nack(false);
        }
    }

    @RabbitSubscribe({
        exchange: 'auth_exchange.dlx',
        routingKey: 'user.registered.dead',
        queue: 'user_registration_queue.dlq',
    })
    public async handleDeadLetter(msg: any, amqpMsg: ConsumeMessage) {
        const deathHeader = amqpMsg.properties.headers?.['x-death'];
        this.logger.error(`[DLQ Alert] Message landed in Dead Letter Queue! Payload:`, msg);
        this.logger.error(`[DLQ Details] Death info:`, deathHeader);
    }
}