import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { RefundMailService } from 'src/common/mail/refund-mail.service';
import { UserEntity } from 'src/modules/auth/entities/user.entity';

interface RefundIssuedPayload {
    refundId: string;
    appointmentId: string;
    userId: string;
    amount: number;
    providerRefundId: string;
    expectedArrivalAt: string;
}


const CONSUMER_NAME = 'refund-email';

@Injectable()
export class RefundEventsConsumer {
    private readonly logger = new Logger(RefundEventsConsumer.name);

    constructor(
        private readonly refundMailService: RefundMailService,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedEvents: Repository<ProcessedEventEntity>,
        @InjectRepository(UserEntity)
        private readonly userRepo: Repository<UserEntity>,
    ) { }

    @RabbitSubscribe({
        exchange: 'payment_exchange',
        routingKey: 'REFUND_ISSUED',
        queue: 'refund_issued_email_queue',
        queueOptions: {
            arguments: {
                'x-dead-letter-exchange': 'payment_exchange.dlx',
                'x-dead-letter-routing-key': 'REFUND_ISSUED.dead',
            },
        },
    })
    public async handleRefundIssued(
        msg: RefundIssuedPayload,
        amqpMsg: ConsumeMessage,
    ) {
        const rawEventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;
        const eventKey = rawEventId ? `${rawEventId}:${CONSUMER_NAME}` : undefined;

        this.logger.log(
            `[RabbitMQ Consumer] Received 'REFUND_ISSUED' event for refundId: ${msg.refundId} (Appointment: ${msg.appointmentId})`,
        );

        if (eventKey) {
            const alreadyProcessed = await this.processedEvents.findOne({
                where: { eventId: eventKey },
            });
            if (alreadyProcessed) {
                this.logger.warn(
                    `[Idempotency] Event ${eventKey} already processed — skipping duplicate refund email.`,
                );
                return;
            }
        }

        try {
            const user = await this.userRepo.findOne({ where: { id: msg.userId } });

            if (!user || !user.email) {
                this.logger.warn(
                    `User or email not found for userId: ${msg.userId}. Sending to DLQ...`,
                );
                return new Nack(false);
            }

            await this.refundMailService.sendRefundConfirmationEmail(user.email, {
                amount: msg.amount,
                expectedArrivalAt: new Date(msg.expectedArrivalAt),
                providerRefundId: msg.providerRefundId,
                appointmentId: msg.appointmentId,
            });

            this.logger.log(
                `[Email Dispatched Successfully] Refund confirmation email sent to ${user.email} for refund ${msg.refundId}`,
            );

            if (eventKey) {
                try {
                    await this.processedEvents.insert({
                        eventId: eventKey,
                        eventType: 'REFUND_ISSUED',
                    });
                } catch (err: any) {
                    if (err.code === '23505') {
                        this.logger.warn(
                            `[Idempotency] Event ${eventKey} was recorded concurrently — refund email already sent.`,
                        );
                    } else {
                        this.logger.error(
                            `Failed to record processed event ${eventKey}: ${err.message}`,
                        );
                    }
                }
            }

            return;
        } catch (error: any) {
            this.logger.error(
                `Failed to send refund confirmation email for refund ${msg.refundId}: ${error.message}`,
                error.stack,
            );

            return new Nack(false);
        }
    }

    @RabbitSubscribe({
        exchange: 'payment_exchange.dlx',
        routingKey: 'REFUND_ISSUED.dead',
        queue: 'refund_issued_email_queue.dlq',
    })
    public async handleDeadLetter(msg: any, amqpMsg: ConsumeMessage) {
        const deathHeader = amqpMsg.properties.headers?.['x-death'];
        this.logger.error(`[DLQ Alert] Refund issued email event landed in DLQ! Payload:`, msg);
        this.logger.error(`[DLQ Details] Death info:`, deathHeader);
    }
}