import { DataSource } from 'typeorm';
import { PrescriptionEntity } from '../entities/prescription.entity';

const enabled = !!process.env.DB_HOST || !!process.env.DB_NAME;
const describeReal = enabled ? describe : describe.skip;

describeReal('AttachPrescription concurrency (real Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'docura',
      entities: [PrescriptionEntity],
      synchronize: true,
    });
    await ds.initialize();
    await ds.query(`TRUNCATE prescriptions`);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('parallel attaches race on appointmentId: exactly one wins, the loser maps 23505 to PRESCRIPTION_ALREADY_EXISTS 409', async () => {
    const appointmentId = '11111111-1111-4111-8111-111111111111';
    const repo = ds.getRepository(PrescriptionEntity);
    const base = {
      appointmentId,
      patientId: '22222222-2222-4222-8222-222222222222',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      uploadedAt: new Date(),
    };
    const results = await Promise.allSettled([
      repo.save(repo.create({ ...base, storageKey: `${appointmentId}/winner-a.pdf`, uploadedBy: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })),
      repo.save(repo.create({ ...base, storageKey: `${appointmentId}/winner-b.pdf`, uploadedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflicts = results.filter(
      (r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason?.code === '23505',
    ).length;
    expect(ok).toBe(1);
    expect(conflicts).toBe(1);
  });
});
