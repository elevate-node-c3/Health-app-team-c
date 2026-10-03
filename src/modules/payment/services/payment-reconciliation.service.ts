import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHoldEntity } from 'src/modules/booking/entities/slot-hold.entity';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { StripeService } from './stripe.service';
import { AlertService } from 'src/common/outbox/services/alert.service';
import { createAppointmentFromHold } from 'src/modules/booking/helpers/create-appointment-from-hold';

const RECONCILE_AGE_MINUTES = 5;
const CLAIM_LIMIT = 20;

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly alertService: AlertService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async execute(now: Date = new Date()): Promise<number> {
    const claimedIds = await this.claimCandidates(now);
    if (claimedIds.length === 0) return 0;

    let resolved = 0;
    for (const id of claimedIds) {
      try {
        const didResolve = await this.dataSource.transaction((manager) =>
          this.resolveOne(manager, id, now),
        );
        if (didResolve) {
          resolved += 1;
          this.logger.log(`Reconciled payment ${id}`);
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Reconcile ${id} failed: ${reason}`);
      }
    }
    return resolved;
  }

  private async claimCandidates(now: Date): Promise<string[]> {
    const threshold = new Date(now.getTime() - RECONCILE_AGE_MINUTES * 60 * 1000);
    try {
      const successRows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM payment_transactions WHERE status = 'SUCCESS' LIMIT ${CLAIM_LIMIT} FOR UPDATE SKIP LOCKED`,
      );
      const reconcileRows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM payment_transactions WHERE status = 'REQUIRES_RECONCILIATION' AND "updatedAt" <= $1 ORDER BY "updatedAt" ASC LIMIT ${CLAIM_LIMIT} FOR UPDATE SKIP LOCKED`,
        [threshold.toISOString()],
      );
      return Array.from(
        new Set([...successRows.map((r) => r.id), ...reconcileRows.map((r) => r.id)]),
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Reconciliation claim failed: ${reason}`);
      return [];
    }
  }

  private async resolveOne(manager: EntityManager, id: string, now: Date): Promise<boolean> {
    const txRepo = manager.getRepository(PaymentTransaction);
    const tx = await txRepo
      .createQueryBuilder('tx')
      .setLock('pessimistic_write')
      .where('tx.id = :id', { id })
      .getOne();

    if (!tx || !this.needsWork(tx, now)) return false;

    const existing = await manager
      .getRepository(AppointmentEntity)
      .findOne({ where: { holdId: tx.holdId } });
    if (existing) return false;

    if (!tx.providerReference) {
      await this.flag(manager, tx.id, tx.holdId, 'Missing provider reference');
      return false;
    }

    let providerStatus = 'unknown';
    try {
      providerStatus = (await this.stripeService.getPaymentIntentStatus(tx.providerReference)).status;
    } catch {
      await txRepo.update(tx.id, { status: PaymentStatus.REQUIRES_RECONCILIATION });
      return false;
    }

    if (providerStatus !== 'succeeded') return this.resolveDeadCharge(manager, tx.id, tx.holdId, providerStatus);
    return this.healCharge(manager, tx.id, tx.holdId);
  }

  private needsWork(tx: PaymentTransaction, now: Date): boolean {
    if (tx.status !== PaymentStatus.SUCCESS && tx.status !== PaymentStatus.REQUIRES_RECONCILIATION)
      return false;
    if (tx.status !== PaymentStatus.REQUIRES_RECONCILIATION) return true;
    const threshold = now.getTime() - RECONCILE_AGE_MINUTES * 60 * 1000;
    const updatedAt = new Date(
      (tx as { updatedAt?: string | Date }).updatedAt ?? threshold,
    ).getTime();
    return updatedAt <= threshold;
  }

  private async resolveDeadCharge(
    manager: EntityManager,
    txId: string,
    holdId: string,
    providerStatus: string,
  ): Promise<boolean> {
    if (providerStatus !== 'canceled' && providerStatus !== 'failed') {
      if (providerStatus === 'unknown') {
        await manager
          .getRepository(PaymentTransaction)
          .update(txId, { status: PaymentStatus.REQUIRES_RECONCILIATION });
      }
      return false;
    }
    await manager.getRepository(PaymentTransaction).update(txId, {
      status: PaymentStatus.FAILED,
      failureReason: `Provider reports ${providerStatus}`,
    });
    await manager.getRepository(OutboxEventEntity).save({
      aggregateType: 'PAYMENT',
      exchange: 'payment_exchange',
      eventType: 'payment.reconciled',
      payload: { paymentTxId: txId, holdId, outcome: 'FAILED' },
    });
    await this.alertService.notifyReconciliation({
      paymentTxId: txId,
      holdId,
      reason: `Provider reports ${providerStatus}`,
    });
    return true;
  }

  private async healCharge(manager: EntityManager, txId: string, holdId: string): Promise<boolean> {
    const hold = await manager.getRepository(SlotHoldEntity).findOne({ where: { id: holdId } });
    if (!hold) {
      await this.flag(manager, txId, holdId, 'Hold not found for SUCCESS charge');
      return false;
    }

    const occupant = await manager.getRepository(AppointmentEntity).findOne({
      where: {
        doctorId: hold.doctorId,
        clinicId: hold.clinicId,
        date: hold.date,
        startTime: hold.startTime,
        status: AppointmentStatus.BOOKED,
      },
    });
    if (occupant) {
      await this.flag(manager, txId, holdId, 'Slot already booked by another patient');
      return false;
    }

    try {
      const appointment = await createAppointmentFromHold(manager, hold);
      await manager.getRepository(OutboxEventEntity).save({
        aggregateType: 'APPOINTMENT',
        exchange: 'appointment_exchange',
        eventType: 'APPOINTMENT_BOOKED',
        payload: {
          appointmentId: appointment.id,
          patientId: hold.patientId,
          doctorId: hold.doctorId,
          clinicId: hold.clinicId,
          date: hold.date,
          startTime: hold.startTime,
          endTime: hold.endTime,
        },
      });
      await manager.getRepository(OutboxEventEntity).save({
        aggregateType: 'PAYMENT',
        exchange: 'payment_exchange',
        eventType: 'payment.reconciled',
        payload: { paymentTxId: txId, holdId, appointmentId: appointment.id, outcome: 'HEALED' },
      });
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== '23505') throw err;
      await this.flag(manager, txId, holdId, 'Lost race to slot winner');
      return false;
    }
  }

  private async flag(manager: EntityManager, txId: string, holdId: string, reason: string): Promise<void> {
    await manager
      .getRepository(PaymentTransaction)
      .update(txId, { status: PaymentStatus.REQUIRES_RECONCILIATION });
    await this.alertService.notifyReconciliation({ paymentTxId: txId, holdId, reason });
  }
}
