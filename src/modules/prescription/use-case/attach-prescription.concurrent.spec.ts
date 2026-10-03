import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppointmentEntity, AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { ClinicEntity } from 'src/modules/catalog/entities/clinic.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { DoctorClinicEntity } from 'src/modules/catalog/entities/doctor-clinic.entity';
import { SpecialtyEntity } from 'src/modules/catalog/entities/specialty.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from '../entities/prescription.entity';
import { LocalPrescriptionStorageService } from '../local-prescription-storage.service';
import { AttachPrescriptionUseCase } from './attach-prescription.use-case';

const enabled = !!process.env.DB_HOST || !!process.env.DB_NAME;
const describeReal = enabled ? describe : describe.skip;

describeReal('AttachPrescription concurrency (real Postgres)', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  let ds: DataSource;
  let storageDir: string;
  let useCase: AttachPrescriptionUseCase;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'prescription-concurrent-'));
    process.env.PRESCRIPTION_STORAGE_PATH = storageDir;

    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'docura',
      entities: [SpecialtyEntity, DoctorEntity, ClinicEntity, DoctorClinicEntity, AppointmentEntity, PrescriptionEntity, OutboxEventEntity],
      synchronize: true,
    });
    await ds.initialize();
    await ds.query(`TRUNCATE prescriptions, outbox_events, appointments CASCADE`);

    const specialty = await ds.getRepository(SpecialtyEntity).save({ name: 'Dentistry' });
    const doctor = await ds.getRepository(DoctorEntity).save({ fullName: 'Sara Mahmoud', specialtyId: specialty.id });
    const clinic = await ds.getRepository(ClinicEntity).save({ name: 'CityCare', governorate: 'Cairo', city: 'Nasr City', address: '1 Road' });
    await ds.getRepository(AppointmentEntity).save({
      id: appointmentId,
      doctorId: doctor.id,
      clinicId: clinic.id,
      patientId: '22222222-2222-4222-8222-222222222222',
      date: '2026-09-01',
      startTime: '10:00:00',
      endTime: '10:30:00',
      status: AppointmentStatus.COMPLETED,
      completedAt: new Date(),
    });

    useCase = new AttachPrescriptionUseCase(
      ds,
      new LocalPrescriptionStorageService(),
      { triggerPublish: jest.fn().mockResolvedValue(undefined) } as never,
      ds.getRepository(PrescriptionEntity),
    );
  });

  afterAll(async () => {
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.PRESCRIPTION_STORAGE_PATH;
    if (ds?.isInitialized) await ds.destroy();
  });

  it('parallel attaches through the use-case: exactly one wins, the loser maps 23505 to PRESCRIPTION_ALREADY_EXISTS 409', async () => {
    const results = await Promise.allSettled([
      useCase.execute(appointmentId, pdfBuffer, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      useCase.execute(appointmentId, pdfBuffer, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const conflicts = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r as PromiseRejectedResult).reason?.response?.code === 'PRESCRIPTION_ALREADY_EXISTS',
    ).length;
    expect(won).toBe(1);
    expect(conflicts).toBe(1);

    expect(await ds.getRepository(PrescriptionEntity).count({ where: { appointmentId } })).toBe(1);
    expect(
      await ds.getRepository(OutboxEventEntity).count({ where: { eventType: 'PRESCRIPTION_ISSUED' } }),
    ).toBe(1);
    expect(readdirSync(join(storageDir, appointmentId))).toHaveLength(1);
  });
});
