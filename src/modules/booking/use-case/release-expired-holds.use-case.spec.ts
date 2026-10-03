import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ReleaseExpiredHoldsUseCase } from './release-expired-holds.use-case';
import { SlotHoldEntity, SlotHoldStatus } from '../entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

function buildDataSource(initial: SlotHoldEntity[]) {
  const store = new Map<string, SlotHoldEntity>();
  for (const h of initial) store.set(h.id, { ...h });
  const outbox: Record<string, unknown>[] = [];

  const holdRepo = {
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
    save: async (entity: SlotHoldEntity) => {
      store.set(entity.id, { ...entity });
      return entity;
    },
  };

  const outboxRepo = {
    save: async (row: Record<string, unknown>) => {
      const saved = { id: `evt-${outbox.length + 1}`, ...row };
      outbox.push(saved);
      return saved;
    },
  };

  const dataSource = {
    query: jest.fn(
      async (_sql: string, _params?: unknown[]): Promise<{ id: string }[]> =>
        Array.from(store.keys()).map((id) => ({ id })),
    ),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<boolean>) => {
      const manager = {
        getRepository: (entity: unknown) =>
          entity === SlotHoldEntity ? holdRepo : outboxRepo,
      };
      return cb(manager);
    }),
  };

  return { dataSource, store, outbox };
}

function activeHold(id: string, expiresAt: Date): SlotHoldEntity {
  const h = new SlotHoldEntity();
  h.id = id;
  h.patientId = 'p1';
  h.doctorId = 'd1';
  h.clinicId = 'c1';
  h.date = '2026-10-01';
  h.startTime = '10:00:00';
  h.endTime = '10:30:00';
  h.frozenFee = 200;
  h.status = SlotHoldStatus.ACTIVE;
  h.expiresAt = expiresAt;
  h.extendedOnce = false;
  return h;
}

describe('ReleaseExpiredHoldsUseCase', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');

  async function runWith(holds: SlotHoldEntity[]) {
    const { dataSource, store, outbox } = buildDataSource(holds);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseExpiredHoldsUseCase,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    return { useCase: module.get(ReleaseExpiredHoldsUseCase), store, outbox, dataSource };
  }

  it('returns 0 when nothing claimed', async () => {
    const { useCase } = await runWith([]);
    await expect(useCase.execute(now)).resolves.toBe(0);
  });

  it('expires ACTIVE hold with one persisted HOLD_EXPIRED row', async () => {
    const { useCase, store, outbox, dataSource } = await runWith([
      activeHold('h1', new Date(now.getTime() - 60000)),
    ]);
    await expect(useCase.execute(now)).resolves.toBe(1);
    expect(store.get('h1')?.status).toBe(SlotHoldStatus.EXPIRED);
    expect(outbox).toHaveLength(1);
    expect((outbox[0] as { eventType: string }).eventType).toBe('HOLD_EXPIRED');
    expect(dataSource.query.mock.calls[0][0]).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(OutboxEventEntity).toBeDefined();
  });

  it('leaves EXPIRED, CONSUMED, and unexpired ACTIVE untouched', async () => {
    const expired = activeHold('h2', new Date(now.getTime() - 60000));
    expired.status = SlotHoldStatus.EXPIRED;
    const consumed = activeHold('h3', new Date(now.getTime() - 60000));
    consumed.status = SlotHoldStatus.CONSUMED;
    const fresh = activeHold('h4', new Date(now.getTime() + 60000));
    const { useCase, store, outbox } = await runWith([expired, consumed, fresh]);
    await expect(useCase.execute(now)).resolves.toBe(0);
    expect(store.get('h2')?.status).toBe(SlotHoldStatus.EXPIRED);
    expect(store.get('h3')?.status).toBe(SlotHoldStatus.CONSUMED);
    expect(store.get('h4')?.status).toBe(SlotHoldStatus.ACTIVE);
    expect(outbox).toHaveLength(0);
  });

  it('double execute writes one outbox row', async () => {
    const { useCase, outbox } = await runWith([
      activeHold('h5', new Date(now.getTime() - 60000)),
    ]);
    await expect(useCase.execute(now)).resolves.toBe(1);
    await expect(useCase.execute(now)).resolves.toBe(0);
    expect(outbox).toHaveLength(1);
  });
});
