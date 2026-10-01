import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { RefundEntity, RefundStatus } from '../entities/refund.entity';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { StripeService } from './stripe.service';

const MAX_ATTEMPTS = 10;
const RETRY_AFTER_SECONDS = 60;
const BUSINESS_DAYS_TO_ARRIVE = 10;

function addBusinessDays(from: Date, days: number): Date {
    const d = new Date(from);
    let added = 0;
    while (added < days) {
        d.setDate(d.getDate() + 1);
        const day = d.getDay();
        if (day !== 5 && day !== 6) added++;
    }
    return d;
}

@Injectable()
export class RefundService {
    private readonly logger = new Logger(RefundService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly stripeService: StripeService,
    ) { }

    async createPendingRefund(
        manager: EntityManager,
        params: { appointmentId: string; holdId: string },
    ): Promise<RefundEntity> {
        const refundRepo = manager.getRepository(RefundEntity);

        const existing = await refundRepo.findOne({ where: { appointmentId: params.appointmentId } });
        if (existing) return existing;

        const paymentTx = await manager
            .getRepository(PaymentTransaction)
            .createQueryBuilder('tx')
            .where('tx.holdId = :holdId', { holdId: params.holdId })
            .andWhere('tx.status != :failed', { failed: PaymentStatus.FAILED })
            .orderBy('tx.createdAt', 'DESC')
            .getOne();

        if (!paymentTx) throw new NotFoundException('No payment found for this appointment');

        const refund = refundRepo.create({
            appointmentId: params.appointmentId,
            paymentTransactionId: paymentTx.id,
            amount: paymentTx.amount,
            status: RefundStatus.PENDING,
            idempotencyKey: `REFUND-${params.appointmentId}`,
        });
        return refundRepo.save(refund);
    }


    async processRefund(refundId: string): Promise<void> {
        const refundRepo = this.dataSource.getRepository(RefundEntity);

        const claimed = await refundRepo
            .createQueryBuilder()
            .update(RefundEntity)
            .set({ attempts: () => '"attempts" + 1', lastAttemptAt: () => 'now()' })
            .where('id = :id', { id: refundId })
            .andWhere('status = :status', { status: RefundStatus.PENDING })
            .andWhere(
                `("lastAttemptAt" IS NULL OR "lastAttemptAt" < now() - interval '${RETRY_AFTER_SECONDS} seconds')`,
            )
            .execute();

        if (!claimed.affected) return;

        const refund = await refundRepo.findOneByOrFail({ id: refundId });
        const paymentTx = await this.dataSource
            .getRepository(PaymentTransaction)
            .findOne({ where: { id: refund.paymentTransactionId } });

        if (!paymentTx || paymentTx.status !== PaymentStatus.SUCCESS || !paymentTx.providerReference) {
            if (refund.attempts >= MAX_ATTEMPTS) {
                await this.markFailed(refund.id, 'Original charge was never confirmed');
            } else {
                this.logger.warn(`Refund ${refund.id} waiting for original charge confirmation`);
            }
            return;
        }

        let result: Awaited<ReturnType<StripeService['refundPayment']>>;
        try {
            result = await this.stripeService.refundPayment({
                paymentIntentId: paymentTx.providerReference,
                amount: Number(refund.amount),
                idempotencyKey: refund.idempotencyKey,
            });
        } catch (err: any) {
            this.logger.error(`Refund ${refund.id} provider call failed: ${err.message}`);
            if (refund.attempts >= MAX_ATTEMPTS) {
                await this.markFailed(refund.id, 'Payment provider unreachable');
            }
            return;
        }

        if (!result.isSuccess) {
            await this.markFailed(refund.id, result.failureReason ?? 'Refund rejected');
            return;
        }

        await this.markIssued(refund, paymentTx.userId, result.refundId!);
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async retryPendingRefunds(): Promise<void> {
        const stale = await this.dataSource
            .getRepository(RefundEntity)
            .createQueryBuilder('r')
            .where('r.status = :status', { status: RefundStatus.PENDING })
            .andWhere(`r."createdAt" < now() - interval '30 seconds'`)
            .andWhere(
                `(r."lastAttemptAt" IS NULL OR r."lastAttemptAt" < now() - interval '${RETRY_AFTER_SECONDS} seconds')`,
            )
            .orderBy('r."createdAt"', 'ASC')
            .limit(20)
            .getMany();

        for (const refund of stale) {
            try {
                await this.processRefund(refund.id);
            } catch (err: any) {
                this.logger.error(`Retry failed for refund ${refund.id}: ${err.message}`);
            }
        }
    }

    private async markIssued(refund: RefundEntity, userId: string, providerRefundId: string) {
        await this.dataSource.transaction(async (manager) => {
            const now = new Date();
            const expectedArrivalAt = addBusinessDays(now, BUSINESS_DAYS_TO_ARRIVE);

            const updated = await manager.getRepository(RefundEntity).update(
                { id: refund.id, status: RefundStatus.PENDING },
                {
                    status: RefundStatus.ISSUED,
                    providerRefundId,
                    issuedAt: now,
                    expectedArrivalAt,
                    failureReason: null,
                },
            );
            if (!updated.affected) return;

            await manager.getRepository(OutboxEventEntity).save({
                aggregateType: 'REFUND',
                aggregateId: refund.id,
                exchange: 'payment_exchange',
                eventType: 'REFUND_ISSUED',
                payload: {
                    refundId: refund.id,
                    appointmentId: refund.appointmentId,
                    userId,
                    amount: Number(refund.amount),
                    providerRefundId,
                    expectedArrivalAt,
                },
            });
        });
        this.logger.log(`Refund ${refund.id} issued (provider: ${providerRefundId})`);
    }

    private async markFailed(refundId: string, reason: string) {
        await this.dataSource
            .getRepository(RefundEntity)
            .update({ id: refundId, status: RefundStatus.PENDING }, { status: RefundStatus.FAILED, failureReason: reason });
        this.logger.error(`Refund ${refundId} FAILED: ${reason}. Needs manual review.`);
    }
}