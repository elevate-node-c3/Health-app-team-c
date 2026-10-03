import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { ClinicEntity } from 'src/modules/catalog/entities/clinic.entity';
import { SpecialtyEntity } from 'src/modules/catalog/entities/specialty.entity';

const enabled = !!process.env.DB_HOST || !!process.env.DB_NAME;
const describeReal = enabled ? describe : describe.skip;

describeReal('Reschedule concurrency (real Postgres)', () => {
  let ds: DataSource;
  let doctorId: string;
  let clinicId: string;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'docura',
      entities: [SpecialtyEntity, DoctorEntity, ClinicEntity, AppointmentEntity],
      synchronize: true,
    });
    await ds.initialize();
    await ds.query(`TRUNCATE appointments`);

    const specialty = await ds.getRepository(SpecialtyEntity).save(
      ds
        .getRepository(SpecialtyEntity)
        .create({ name: `resched-concurrency-${Date.now()}` }),
    );
    const doctor = await ds.getRepository(DoctorEntity).save(
      ds.getRepository(DoctorEntity).create({
        fullName: 'Concurrency Doctor',
        specialtyId: specialty.id,
      }),
    );
    const clinic = await ds.getRepository(ClinicEntity).save(
      ds.getRepository(ClinicEntity).create({
        name: 'Concurrency Clinic',
        governorate: 'Cairo',
        city: 'Cairo',
        address: '1 Test St',
      }),
    );
    doctorId = doctor.id;
    clinicId = clinic.id;
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('two parallel BOOKED inserts on the same slot yield exactly one winner', async () => {
    const base = {
      doctorId,
      clinicId,
      date: '2026-11-01',
      startTime: '10:00',
      endTime: '10:30',
      status: AppointmentStatus.BOOKED,
    };
    const repo = ds.getRepository(AppointmentEntity);
    const results = await Promise.allSettled([
      repo.save(repo.create({ ...base, patientId: randomUUID() })),
      repo.save(repo.create({ ...base, patientId: randomUUID() })),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r as PromiseRejectedResult).reason?.code === '23505',
    ).length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
  });
});
