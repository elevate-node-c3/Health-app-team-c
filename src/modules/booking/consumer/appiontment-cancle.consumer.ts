import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { SlotHoldEntity, SlotHoldStatus } from '../entities/slot-hold.entity';

interface AppointmentCancelledPayload {
    appointmentId: string;
    patientId: string;
    doctorId: string;
    clinicId: string;
    holdId: string | null;
    cancelledAt: Date;
    cancellationOutcome: string;
}

const CONSUMER_NAME = 'slot-release';

@Injectable()
export class AppointmentCancelledConsumer {
    private readonly logger = new Logger(AppointmentCancelledConsumer.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedEvents: Repository<ProcessedEventEntity>,
    ) { }

    @RabbitSubscribe({
        exchange: 'appointment_exchange',
        routingKey: 'APPOINTMENT_CANCELLED',
        queue: 'appointment_cancelled_slot_release_queue',
        queueOptions: {
            arguments: {
                'x-dead-letter-exchange': 'appointment_exchange.dlx',
                'x-dead-letter-routing-key': 'APPOINTMENT_CANCELLED.dead',
            },
        },
    })
    public async handleAppointmentCancelled(
        msg: AppointmentCancelledPayload,
        amqpMsg: ConsumeMessage,
    ) {
        const rawEventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;
        const eventKey = rawEventId ? `${rawEventId}:${CONSUMER_NAME}` : undefined;

        this.logger.log(
            `[RabbitMQ Consumer] Received 'APPOINTMENT_CANCELLED' event for appointment: ${msg.appointmentId} (hold: ${msg.holdId})`,
        );

        if (eventKey) {
            const alreadyProcessed = await this.processedEvents.findOne({
                where: { eventId: eventKey },
            });
            if (alreadyProcessed) {
                this.logger.warn(
                    `[Idempotency] Event ${eventKey} already processed — skipping duplicate slot release.`,
                );
                return;
            }
        }

        if (!msg.holdId) {
            this.logger.warn(
                `Appointment ${msg.appointmentId} has no holdId: nothing to release.`,
            );
            return;
        }

        try {
            await this.dataSource.transaction(async (manager) => {
                const holdRepo = manager.getRepository(SlotHoldEntity);

                const hold = await holdRepo
                    .createQueryBuilder('hold')
                    .setLock('pessimistic_write')
                    .where('hold.id = :id', { id: msg.holdId })
                    .getOne();

                if (!hold) {
                    this.logger.warn(`SlotHold with ID ${msg.holdId} not found.`);
                    return;
                }

                if (hold.status === SlotHoldStatus.CONSUMED) {
                    this.logger.log(
                        `SlotHold ${msg.holdId} is CONSUMED: slot already free via appointment status, nothing to change.`,
                    );
                    return;
                }

                if (hold.status === SlotHoldStatus.EXPIRED) {
                    this.logger.log(`SlotHold ${msg.holdId} is already EXPIRED. Idempotent skip.`);
                    return;
                }

                hold.status = SlotHoldStatus.EXPIRED;
                await holdRepo.save(hold);

                this.logger.warn(
                    `[Slot Released] SlotHold ${msg.holdId} was still ACTIVE for cancelled appointment ${msg.appointmentId}`,
                );
            });

            if (eventKey) {
                try {
                    await this.processedEvents.insert({
                        eventId: eventKey,
                        eventType: 'APPOINTMENT_CANCELLED',
                    });
                } catch (err: any) {
                    if (err.code === '23505') {
                        this.logger.warn(
                            `[Idempotency] Event ${eventKey} was recorded concurrently — slot release already processed.`,
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
                `Failed to release SlotHold ${msg.holdId} for appointment ${msg.appointmentId}: ${error.message}`,
                error.stack,
            );

            return new Nack(false);
        }
    }

    @RabbitSubscribe({
        exchange: 'appointment_exchange.dlx',
        routingKey: 'APPOINTMENT_CANCELLED.dead',
        queue: 'appointment_cancelled_slot_release_queue.dlq',
    })
    public async handleDeadLetter(msg: any, amqpMsg: ConsumeMessage) {
        const deathHeader = amqpMsg.properties.headers?.['x-death'];
        this.logger.error(`[DLQ Alert] Appointment cancelled slot release landed in DLQ! Payload:`, msg);
        this.logger.error(`[DLQ Details] Death info:`, deathHeader);
    }
}