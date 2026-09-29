import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import * as Stripe from 'stripe';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHold } from '../entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

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
            const holdRepo = manager.getRepository(SlotHold);
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
                    amount: paymentTx.amount,
                    providerReference: stripeRef,
                },
            });

            const hold = await holdRepo.findOne({ where: { id: paymentTx.holdId } });
            if (hold && !hold.isConsumed) {
                hold.isConsumed = true;
                await holdRepo.save(hold);

                await outboxRepo.save({
                    aggregateType: 'APPOINTMENT',
                    aggregateId: hold.slotId,
                    exchange: 'appointment_exchange',
                    eventType: 'APPOINTMENT_BOOKED',
                    payload: {
                        userId: paymentTx.userId,
                        doctorId: hold.doctorId,
                        slotId: hold.slotId,
                        instructions: 'Please arrive 15 minutes before the appointment.',
                    },
                });
                this.logger.log(`Appointment booked via Webhook for Slot: ${hold.slotId}`);
            } else if (!hold) {
                this.logger.error(
                    `Payment ${paymentTx.id} succeeded but hold ${paymentTx.holdId} not found. Needs manual reconciliation.`,
                );
                await manager.getRepository(PaymentTransaction).update(paymentTx.id, {
                    status: PaymentStatus.REQUIRES_RECONCILIATION,
                });
            }
        });
    }

    private async processFailedPayment(paymentIntent: Stripe.PaymentIntent) {
        const stripeRef = paymentIntent.id;
        const idempotencyKey = paymentIntent.metadata?.idempotencyKey;

        await this.dataSource.transaction(async (manager: EntityManager) => {
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const holdRepo = manager.getRepository(SlotHold);
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

            await holdRepo.delete(paymentTx.holdId);
            this.logger.log(`Hold released via Webhook for Hold ID: ${paymentTx.holdId}`);

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