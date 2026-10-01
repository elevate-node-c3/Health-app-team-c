import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import * as Stripe from 'stripe';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHoldEntity, SlotHoldStatus } from 'src/modules/booking/entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { createAppointmentFromHold } from 'src/modules/booking/helpers/create-appointment-from-hold';

@Injectable()
export class HandleStripeWebhookUseCase {
    private readonly logger = new Logger(HandleStripeWebhookUseCase.name);

    constructor(private readonly dataSource: DataSource) { }

    async execute(event: Stripe.Event) {
        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            await this.processSuccessfulPayment(paymentIntent);
        } else if (event.type === 'payment_intent.payment_failed') {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            await this.processFailedPayment(paymentIntent);
        }

        return { received: true };
    }

    private async processSuccessfulPayment(paymentIntent: Stripe.PaymentIntent) {
        const stripeRef = paymentIntent.id;
        const idempotencyKey = paymentIntent.metadata?.idempotencyKey;

        await this.dataSource.transaction(async (manager: EntityManager) => {
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const holdRepo = manager.getRepository(SlotHoldEntity);
            const outboxRepo = manager.getRepository(OutboxEventEntity);

            let query = paymentRepo.createQueryBuilder('tx').setLock('pessimistic_write');

            if (idempotencyKey) {
                query = query.where('tx.idempotencyKey = :idempotencyKey', { idempotencyKey });
            } else {
                query = query.where('tx.providerReference = :stripeRef', { stripeRef });
            }

            const paymentTx = await query.getOne();

            if (!paymentTx) {
                this.logger.warn(`No transaction found for Stripe Intent: ${stripeRef}`);
                return;
            }

            if (paymentTx.status === PaymentStatus.SUCCESS) {
                this.logger.log(`Payment transaction ${paymentTx.id} was already processed directly.`);
                return;
            }

            const hold = await holdRepo
                .createQueryBuilder('hold')
                .setLock('pessimistic_write')
                .where('hold.id = :holdId', { holdId: paymentTx.holdId })
                .getOne();

            const holdUsable =
                !!hold &&
                (hold.status === SlotHoldStatus.ACTIVE || hold.status === SlotHoldStatus.CONSUMED);

            if (!holdUsable) {
                this.logger.error(
                    `Payment ${paymentTx.id} succeeded but hold ${paymentTx.holdId} is ${hold ? hold.status : 'missing'
                    }. Needs manual reconciliation.`,
                );
                await paymentRepo.update(paymentTx.id, {
                    status: PaymentStatus.REQUIRES_RECONCILIATION,
                    providerReference: stripeRef,
                    failureReason: 'Charged but hold not active',
                });
                return;
            }

            paymentTx.status = PaymentStatus.SUCCESS;
            paymentTx.providerReference = stripeRef;
            await paymentRepo.save(paymentTx);

            await outboxRepo.save({
                aggregateType: 'PAYMENT',
                aggregateId: paymentTx.id,
                exchange: 'payment_exchange',
                eventType: 'PAYMENT_SUCCEEDED',
                payload: {
                    userId: paymentTx.userId,
                    paymentTxId: paymentTx.id,
                    holdId: paymentTx.holdId,
                    amount: Number(paymentTx.amount),
                    providerReference: stripeRef,
                },
            });

            if (hold!.status === SlotHoldStatus.ACTIVE) {
                await holdRepo.update(hold!.id, { status: SlotHoldStatus.CONSUMED });

                const appointment = await createAppointmentFromHold(manager, hold!);

                await outboxRepo.save({
                    aggregateType: 'APPOINTMENT',
                    aggregateId: appointment.id,
                    exchange: 'appointment_exchange',
                    eventType: 'APPOINTMENT_BOOKED',
                    payload: {
                        appointmentId: appointment.id,
                        userId: paymentTx.userId,
                        patientId: hold!.patientId,
                        holdId: hold!.id,
                        doctorId: hold!.doctorId,
                        clinicId: hold!.clinicId,
                        date: hold!.date,
                        startTime: hold!.startTime,
                        endTime: hold!.endTime,
                        instructions: 'Please arrive 15 minutes before the appointment.',
                    },
                });
                this.logger.log(
                    `Appointment ${appointment.id} booked via Webhook for hold ${hold!.id} (${hold!.date} ${hold!.startTime})`,
                );
            }
        });
    }

    private async processFailedPayment(paymentIntent: Stripe.PaymentIntent) {
        const stripeRef = paymentIntent.id;
        const idempotencyKey = paymentIntent.metadata?.idempotencyKey;

        await this.dataSource.transaction(async (manager: EntityManager) => {
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const holdRepo = manager.getRepository(SlotHoldEntity);
            const outboxRepo = manager.getRepository(OutboxEventEntity);

            let query = paymentRepo.createQueryBuilder('tx').setLock('pessimistic_write');

            if (idempotencyKey) {
                query = query.where('tx.idempotencyKey = :idempotencyKey', { idempotencyKey });
            } else {
                query = query.where('tx.providerReference = :stripeRef', { stripeRef });
            }

            const paymentTx = await query.getOne();
            if (!paymentTx || paymentTx.status === PaymentStatus.SUCCESS) return;

            paymentTx.status = PaymentStatus.FAILED;
            paymentTx.failureReason = paymentIntent.last_payment_error?.message || 'Payment failed';
            await paymentRepo.save(paymentTx);

            const released = await holdRepo.update(
                { id: paymentTx.holdId, status: SlotHoldStatus.ACTIVE },
                { status: SlotHoldStatus.EXPIRED },
            );
            if (released.affected) {
                this.logger.log(`Hold released via Webhook for Hold ID: ${paymentTx.holdId}`);
            }

            await outboxRepo.save({
                aggregateType: 'PAYMENT',
                aggregateId: paymentTx.id,
                exchange: 'payment_exchange',
                eventType: 'PAYMENT_FAILED',
                payload: {
                    userId: paymentTx.userId,
                    paymentTxId: paymentTx.id,
                    holdId: paymentTx.holdId,
                    reason: paymentTx.failureReason,
                },
            });
        });
    }
}