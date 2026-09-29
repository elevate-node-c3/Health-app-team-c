import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { AppointmentMailService } from 'src/common/mail/appointment-mail.service';
import { AuthService } from 'src/modules/auth/auth.service';
import { UserEntity } from 'src/modules/auth/entities/user.entity';

interface AppointmentBookedPayload {
    userId: string;
    doctorId: string;
    slotId: string;
    instructions: string;
}

@Injectable()
export class AppointmentEventsConsumer {
    private readonly logger = new Logger(AppointmentEventsConsumer.name);

    constructor(
        private readonly appointmentMailService: AppointmentMailService,
        private readonly userService: AuthService,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedEvents: Repository<ProcessedEventEntity>,
        @InjectRepository(UserEntity)
        private readonly userEntity: Repository<UserEntity>,
    ) { }

    @RabbitSubscribe({
        exchange: 'appointment_exchange',
        routingKey: 'APPOINTMENT_BOOKED',
        queue: 'appointment_confirmation_email_queue',
        queueOptions: {
            arguments: {
                'x-dead-letter-exchange': 'appointment_exchange.dlx',
                'x-dead-letter-routing-key': 'APPOINTMENT_BOOKED.dead',
            },
        },
    })
    public async handleAppointmentBooked(
        msg: AppointmentBookedPayload,
        amqpMsg: ConsumeMessage,
    ) {
        const eventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;

        this.logger.log(
            `[RabbitMQ Consumer] Received 'APPOINTMENT_BOOKED' event for slot: ${msg.slotId}`,
        );

        if (eventId) {
            const alreadyProcessed = await this.processedEvents.findOne({
                where: { eventId },
            });
            if (alreadyProcessed) {
                this.logger.warn(
                    `[Idempotency] Event ${eventId} already processed — skipping duplicate email.`,
                );
                return;
            }
        }

        try {
            const user = await this.userEntity.findOne({ where: { id: msg.userId } });

            if (!user || !user.email) {
                this.logger.warn(
                    `User or email not found for userId: ${msg.userId}. Sending to DLQ...`,
                );
                return new Nack(false);
            }

            await this.appointmentMailService.sendBookingConfirmation(user.email, {
                doctorId: msg.doctorId,
                slotId: msg.slotId,
                instructions: msg.instructions,
            });

            this.logger.log(
                `[Email Dispatched Successfully] Appointment confirmation sent to ${user.email}`,
            );

            if (eventId) {
                try {
                    await this.processedEvents.insert({
                        eventId,
                        eventType: 'APPOINTMENT_BOOKED',
                    });
                } catch (err: any) {
                    if (err.code === '23505') {
                        this.logger.warn(
                            `[Idempotency] Event ${eventId} was recorded concurrently — email already sent.`,
                        );
                    } else {
                        this.logger.error(
                            `Failed to record processed event ${eventId}: ${err.message}`,
                        );
                    }
                }
            }

            return;
        } catch (error: any) {
            this.logger.error(
                `Failed to send appointment confirmation email for slot ${msg.slotId}: ${error.message}`,
                error.stack,
            );

            return new Nack(false);
        }
    }

    @RabbitSubscribe({
        exchange: 'appointment_exchange.dlx',
        routingKey: 'APPOINTMENT_BOOKED.dead',
        queue: 'appointment_confirmation_email_queue.dlq',
    })
    public async handleDeadLetter(msg: any, amqpMsg: ConsumeMessage) {
        const deathHeader = amqpMsg.properties.headers?.['x-death'];
        this.logger.error(`[DLQ Alert] Appointment email event landed in DLQ! Payload:`, msg);
        this.logger.error(`[DLQ Details] Death info:`, deathHeader);
    }
}