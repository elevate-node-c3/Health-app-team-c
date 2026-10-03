import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RefundService } from './refund.service';
import { RefundEntity, RefundStatus } from '../entities/refund.entity';
import { StripeService } from './stripe.service';
import { AlertService } from 'src/common/outbox/services/alert.service';

function buildDataSource(refunds: RefundEntity[], providerStatus: string) {
  const store = new Map<string, RefundEntity>();
  for (const r of refunds) store.set(r.id, { ...r });
  const outbox: Record<string, unknown>[] = [];

  const refundRepo = {
    createQueryBuilder: () => {
      let wantedId = '';
      const qb = {
        setLock: () => qb,
        where: (_: string, params: { id: string }) => {
          wantedId = params.id;
          return qb;
        },
        getOne: async () => store.get(wantedId) ?? null,
      };
      return qb;
    },
    update: jest.fn(
      async (
        criteria: { id: string; status?: RefundStatus },
        partial: Partial<RefundEntity>,
      ) => {
        const current = store.get(criteria.id);
        if (current && criteria.status && current.status === criteria.status) {
          Object.assign(current, partial);
          return { affected: 1 };
        }
        if (current && !criteria.status) {
          Object.assign(current, partial);
          return { affected: 1 };
        }
        return { affected: 0 };
      },
    ),
  };

  const outboxRepo = {
    save: jest.fn(async (row: Record<string, unknown>) => {
      const saved = { id: `evt-${outbox.length + 1}`, ...row };
      outbox.push(saved);
      return saved;
    }),
  };

  const dataSource = {
    query: jest.fn(async () => Array.from(store.keys()).map((id) => ({ id }))),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<boolean>) => {
      const manager = {
        getRepository: (entity: unknown) =>
          (entity as { name?: string }).name === 'RefundEntity' || entity === RefundEntity
            ? refundRepo
            : outboxRepo,
      };
      return cb(manager);
    }),
    getRepository: jest.fn(() => refundRepo),
  };

  const stripe = { getRefundStatus: jest.fn(async () => ({ status: providerStatus })) };
  const alerts = { notifyRefundFailed: jest.fn(), notifyReconciliation: jest.fn(), notifyPermanentFailure: jest.fn() };

  return { dataSource, store, outbox, stripe, alerts };
}

function issuedRefund(id: string): RefundEntity {
  const r = new RefundEntity();
  r.id = id;
  r.appointmentId = 'appt-1';
  r.paymentTransactionId = 'tx-1';
  r.amount = 200;
  r.status = RefundStatus.ISSUED;
  r.providerRefundId = 're_123';
  return r;
}

describe('RefundService.checkSettledRefunds', () => {
  async function runWith(refunds: RefundEntity[], providerStatus: string) {
    const built = buildDataSource(refunds, providerStatus);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: DataSource, useValue: built.dataSource },
        { provide: StripeService, useValue: built.stripe },
        { provide: AlertService, useValue: built.alerts },
      ],
    }).compile();
    return { useCase: module.get(RefundService), ...built };
  }

  it('moves provider-settled rows to SETTLED with settledAt and one refund.settled row', async () => {
    const { useCase, store, outbox } = await runWith([issuedRefund('ref1')], 'succeeded');
    const now = new Date('2026-10-01T10:00:00.000Z');
    await expect(useCase.checkSettledRefunds(now)).resolves.toBe(1);
    expect(store.get('ref1')?.status).toBe(RefundStatus.SETTLED);
    expect(store.get('ref1')?.settledAt).toEqual(now);
    expect(outbox).toHaveLength(1);
    expect((outbox[0] as { eventType: string }).eventType).toBe('refund.settled');
  });

  it('marks provider-failed rows FAILED with alert', async () => {
    const { useCase, store, alerts } = await runWith([issuedRefund('ref2')], 'failed');
    await expect(useCase.checkSettledRefunds(new Date())).resolves.toBe(1);
    expect(store.get('ref2')?.status).toBe(RefundStatus.FAILED);
    expect(alerts.notifyRefundFailed).toHaveBeenCalled();
  });

  it('leaves pending provider states untouched', async () => {
    const { useCase, store, outbox } = await runWith([issuedRefund('ref3')], 'pending');
    await expect(useCase.checkSettledRefunds(new Date())).resolves.toBe(0);
    expect(store.get('ref3')?.status).toBe(RefundStatus.ISSUED);
    expect(outbox).toHaveLength(0);
  });
});
