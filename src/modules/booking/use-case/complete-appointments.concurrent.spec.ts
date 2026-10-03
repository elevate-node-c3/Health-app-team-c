import { DataSource } from 'typeorm';
import { CompleteAppointmentsUseCase } from './complete-appointments.use-case';
import { AppointmentEntity, AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

const enabled = !!process.env.DB_HOST || !!process.env.DB_NAME;
const describeReal = enabled ? describe : describe.skip;

describeReal('CompleteAppointments concurrency (real Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'docura',
      entities: [AppointmentEntity, OutboxEventEntity],
      synchronize: true,
    });
    await ds.initialize();
    await ds.query(`TRUNCATE appointments, outbox_events`);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('two parallel completion claims yield exactly one winner', async () => {
    const repo = ds.getRepository(AppointmentEntity);
    const appointment = repo.create({
      doctorId: '11111111-1111-1111-1111-111111111111',
      clinicId: '22222222-2222-2222-2222-222222222222',
      patientId: '33333333-3333-3333-3333-333333333333',
      date: '2026-09-01',
      startTime: '08:00:00',
      endTime: '08:30:00',
      status: AppointmentStatus.BOOKED,
    });
    const saved = await repo.save(appointment);
    const now = new Date('2026-10-01T10:00:00.000Z');

    const first = new CompleteAppointmentsUseCase(ds);
    const second = new CompleteAppointmentsUseCase(ds);
    const results = await Promise.all([first.execute(now), second.execute(now)]);
    const total = results[0] + results[1];

    expect(total).toBe(1);

    const fresh = await repo.findOne({ where: { id: saved.id } });
    expect([AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW]).toContain(fresh?.status);

    const outboxCount = await ds.getRepository(OutboxEventEntity).count();
    expect(outboxCount).toBe(1);
  });
});
