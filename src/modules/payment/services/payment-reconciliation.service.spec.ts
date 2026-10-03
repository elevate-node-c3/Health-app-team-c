import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHoldEntity } from 'src/modules/booking/entities/slot-hold.entity';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { StripeService } from './stripe.service';
import { AlertService } from 'src/common/outbox/services/alert.service';

function buildDataSource(
  txs: PaymentTransaction[],
  holds: SlotHoldEntity[],
  appointments: AppointmentEntity[],
  providerStatus: string,
) {
  const txStore = new Map<string, PaymentTransaction>();
  for (const t of txs) txStore.set(t.id, { ...t });
  const holdStore = new Map<string, SlotHoldEntity>();
  for (const h of holds) holdStore.set(h.id, { ...h });
  const apptStore = new Map<string, AppointmentEntity>();
  for (const a of appointments) apptStore.set(a.id, { ...a });
  const outbox: Record<string, unknown>[] = [];

  const txRepo = {
    createQueryBuilder: () => {
      let wantedId = '';
      const qb = {
        setLock: () => qb,
        where: (_: string, params: { id: string }) => {
          wantedId = params.id;
          return qb;
        },
        getOne: async () => txStore.get(wantedId) ?? null,
      };
      return qb;
    },
    update: jest.fn(async (criteria: string | { id: string }, partial: Partial<PaymentTransaction>) => {
      const id = typeof criteria === 'string' ? criteria : criteria.id;
      const current = txStore.get(id);
      if (current) Object.assign(current, partial);
      return { affected: 1 };
    }),
  };

  const apptRepo = {
    findOne: jest.fn(async ({ where }: { where: Partial<AppointmentEntity> & { holdId?: string } }) => {
      if (where.holdId) {
        return Array.from(apptStore.values()).find((a) => a.holdId === where.holdId) ?? null;
      }
      return (
        Array.from(apptStore.values()).find(
          (a) =>
            a.doctorId === where.doctorId &&
            a.clinicId === where.clinicId &&
            a.date === where.date &&
            a.startTime === where.startTime &&
            a.status === AppointmentStatus.BOOKED,
        ) ?? null
      );
    }),
    create: jest.fn((dto: Partial<AppointmentEntity>) => ({ ...dto }) as AppointmentEntity),
    save: jest.fn(async (entity: AppointmentEntity) => {
      const saved = { ...entity, id: entity.id ?? `appt-${apptStore.size + 1}` };
      apptStore.set(saved.id, saved as AppointmentEntity);
      return saved as AppointmentEntity;
    }),
  };

  const holdRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => holdStore.get(where.id) ?? null),
  };

  const doctorRepo = { findOne: jest.fn(async () => null) };

  const outboxRepo = {
    save: jest.fn(async (row: Record<string, unknown>) => {
      const saved = { id: `evt-${outbox.length + 1}`, ...row };
      outbox.push(saved);
      return saved;
    }),
  };

  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes(`'SUCCESS'`)) {
        return Array.from(txStore.values())
          .filter((t) => t.status === PaymentStatus.SUCCESS)
          .map((t) => ({ id: t.id }));
      }
      return Array.from(txStore.values())
        .filter((t) => t.status === PaymentStatus.REQUIRES_RECONCILIATION)
        .map((t) => ({ id: t.id }));
    }),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<boolean>) => {
      const manager = {
        getRepository: (entity: unknown) => {
          if (entity === PaymentTransaction) return txRepo;
          if (entity === SlotHoldEntity) return holdRepo;
          if (entity === AppointmentEntity) return apptRepo;
          if ((entity as { name?: string }).name === 'DoctorEntity') return doctorRepo;
          return outboxRepo;
        },
      };
      return cb(manager);
    }),
  };

  const stripe = {
    getPaymentIntentStatus: jest.fn(async () => ({ status: providerStatus })),
    getRefundStatus: jest.fn(),
  };

  const alerts = { notifyReconciliation: jest.fn(), notifyRefundFailed: jest.fn(), notifyPermanentFailure: jest.fn() };

  return { dataSource, txStore, apptStore, outbox, stripe, alerts };
}

function tx(id: string, holdId: string, status: PaymentStatus): PaymentTransaction {
  const t = new PaymentTransaction();
  t.id = id;
  t.userId = 'user-1';
  t.holdId = holdId;
  t.amount = 200;
  t.status = status;
  t.idempotencyKey = `PAY-${holdId}-user-1`;
  t.providerReference = 'pi_123';
  (t as unknown as Record<string, unknown>).updatedAt = new Date('2026-10-01T09:00:00.000Z');
  return t;
}

function hold(id: string): SlotHoldEntity {
  const h = new SlotHoldEntity();
  h.id = id;
  h.patientId = 'user-1';
  h.doctorId = 'doctor-1';
  h.clinicId = 'clinic-1';
  h.date = '2026-10-02';
  h.startTime = '10:00:00';
  h.endTime = '10:30:00';
  h.frozenFee = 200;
  return h;
}

describe('PaymentReconciliationService', () => {
  async function runWith(
    txs: PaymentTransaction[],
    holds: SlotHoldEntity[],
    appointments: AppointmentEntity[],
    providerStatus: string,
  ) {
    const built = buildDataSource(txs, holds, appointments, providerStatus);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentReconciliationService,
        { provide: DataSource, useValue: built.dataSource },
        { provide: StripeService, useValue: built.stripe },
        { provide: AlertService, useValue: built.alerts },
      ],
    }).compile();
    return { useCase: module.get(PaymentReconciliationService), ...built };
  }

  it('heals orphan SUCCESS with free slot to one appointment plus payment.reconciled', async () => {
    const { useCase, apptStore, outbox, txStore } = await runWith(
      [tx('tx1', 'hold1', PaymentStatus.SUCCESS)],
      [hold('hold1')],
      [],
      'succeeded',
    );
    await expect(useCase.execute(new Date('2026-10-01T10:00:00.000Z'))).resolves.toBe(1);
    expect(apptStore.size).toBe(1);
    expect(outbox.filter((o) => (o as { eventType: string }).eventType === 'payment.reconciled')).toHaveLength(1);
    expect(outbox.filter((o) => (o as { eventType: string }).eventType === 'APPOINTMENT_BOOKED')).toHaveLength(1);
    expect(txStore.get('tx1')?.status).toBe(PaymentStatus.SUCCESS);
  });

  it('leaves orphan SUCCESS flagged with alert when slot taken', async () => {
    const occupant = new AppointmentEntity();
    occupant.id = 'appt-winner';
    occupant.doctorId = 'doctor-1';
    occupant.clinicId = 'clinic-1';
    occupant.date = '2026-10-02';
    occupant.startTime = '10:00:00';
    occupant.status = AppointmentStatus.BOOKED;
    const { useCase, apptStore, outbox, alerts, txStore } = await runWith(
      [tx('tx2', 'hold2', PaymentStatus.SUCCESS)],
      [hold('hold2')],
      [occupant],
      'succeeded',
    );
    await expect(useCase.execute(new Date('2026-10-01T10:00:00.000Z'))).resolves.toBe(0);
    expect(apptStore.size).toBe(1);
    expect(txStore.get('tx2')?.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
    expect(alerts.notifyReconciliation).toHaveBeenCalled();
    expect(outbox).toHaveLength(0);
  });

  it('marks provider-dead charge FAILED with alert and reconciled event', async () => {
    const { useCase, txStore, outbox } = await runWith(
      [tx('tx3', 'hold3', PaymentStatus.REQUIRES_RECONCILIATION)],
      [hold('hold3')],
      [],
      'canceled',
    );
    await expect(useCase.execute(new Date('2026-10-01T10:00:00.000Z'))).resolves.toBe(1);
    expect(txStore.get('tx3')?.status).toBe(PaymentStatus.FAILED);
    expect(outbox.filter((o) => (o as { eventType: string }).eventType === 'payment.reconciled')).toHaveLength(1);
  });

  it('double execute resolves once', async () => {
    const { useCase, outbox } = await runWith(
      [tx('tx4', 'hold4', PaymentStatus.SUCCESS)],
      [hold('hold4')],
      [],
      'succeeded',
    );
    const now = new Date('2026-10-01T10:00:00.000Z');
    await expect(useCase.execute(now)).resolves.toBe(1);
    await expect(useCase.execute(now)).resolves.toBe(0);
    expect(outbox.filter((o) => (o as { eventType: string }).eventType === 'payment.reconciled')).toHaveLength(1);
  });
});
