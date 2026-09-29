/**
 * Concurrent exactly-one-winner test — needs real Postgres.
 * Run: docker compose up -d postgres, then npx jest src/modules/booking/use-case/create-hold.concurrent.spec.ts
 */
import { DataSource } from 'typeorm';
import { SlotHoldEntity } from '../entities/slot-hold.entity';

const enabled = !!process.env.DB_HOST || !!process.env.DB_NAME;
const describeReal = enabled ? describe : describe.skip;

describeReal('CreateHold concurrency (real Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'docura',
      entities: [SlotHoldEntity],
      synchronize: true,
    });
    await ds.initialize();
    await ds.query(`TRUNCATE slot_holds`);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('two parallel inserts → exactly one winner', async () => {
    const base: any = {
      doctorId: '11111111-1111-1111-1111-111111111111',
      clinicId: '22222222-2222-2222-2222-222222222222',
      date: '2026-11-01',
      startTime: '10:00',
      endTime: '10:30',
      frozenFee: '200.00',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
    const repo = ds.getRepository(SlotHoldEntity);
    const results = await Promise.allSettled([
      repo.save(repo.create({ ...base, patientId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })),
      repo.save(repo.create({ ...base, patientId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter(
      (r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason?.code === '23505',
    ).length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
  });
});
