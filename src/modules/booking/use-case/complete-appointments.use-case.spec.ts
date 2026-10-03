import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CompleteAppointmentsUseCase } from './complete-appointments.use-case';
import { AppointmentEntity, AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';

function buildDataSource(initial: AppointmentEntity[]) {
  const store = new Map<string, AppointmentEntity>();
  for (const a of initial) store.set(a.id, { ...a });
  const outbox: Record<string, unknown>[] = [];

  const appointmentRepo = {
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
    save: async (entity: AppointmentEntity) => {
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
    query: jest.fn(async () => Array.from(store.keys()).map((id) => ({ id }))),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<boolean>) => {
      const manager = {
        getRepository: (entity: unknown) =>
          entity === AppointmentEntity ? appointmentRepo : outboxRepo,
      };
      return cb(manager);
    }),
  };

  return { dataSource, store, outbox };
}

function bookedAppointment(id: string, date: string, startTime: string): AppointmentEntity {
  const a = new AppointmentEntity();
  a.id = id;
  a.patientId = 'patient-1';
  a.doctorId = 'doctor-1';
  a.clinicId = 'clinic-1';
  a.date = date;
  a.startTime = startTime;
  a.endTime = '10:30:00';
  a.status = AppointmentStatus.BOOKED;
  a.completedAt = null;
  a.noShowAt = null;
  return a;
}

describe('CompleteAppointmentsUseCase', () => {
  const date = '2026-10-01';
  const startTime = '10:00:00';
  const start = getAppointmentStart({ date, startTime });
  const MIN = 60 * 1000;

  async function runWith(appointments: AppointmentEntity[], now: Date) {
    const { dataSource, store, outbox } = buildDataSource(appointments);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompleteAppointmentsUseCase,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    const useCase = module.get(CompleteAppointmentsUseCase);
    const processed = await useCase.execute(now);
    return { processed, store, outbox, dataSource };
  }

  it('completes when start is exactly now with one APPOINTMENT_COMPLETED row', async () => {
    const { processed, store, outbox } = await runWith(
      [bookedAppointment('a1', date, startTime)],
      new Date(start.getTime()),
    );
    expect(processed).toBe(1);
    expect(store.get('a1')?.status).toBe(AppointmentStatus.COMPLETED);
    expect(store.get('a1')?.completedAt).toEqual(new Date(start.getTime()));
    expect(outbox).toHaveLength(1);
    expect((outbox[0] as { eventType: string }).eventType).toBe('APPOINTMENT_COMPLETED');
  });

  it('completes at 119 minutes past and marks NO_SHOW at 121 minutes past', async () => {
    const first = await runWith(
      [bookedAppointment('a2', date, startTime)],
      new Date(start.getTime() + 119 * MIN),
    );
    expect(first.store.get('a2')?.status).toBe(AppointmentStatus.COMPLETED);

    const second = await runWith(
      [bookedAppointment('a3', date, startTime)],
      new Date(start.getTime() + 121 * MIN),
    );
    expect(second.store.get('a3')?.status).toBe(AppointmentStatus.NO_SHOW);
    expect(second.store.get('a3')?.noShowAt).toEqual(new Date(start.getTime() + 121 * MIN));
    expect((second.outbox[0] as { eventType: string }).eventType).toBe('APPOINTMENT_NO_SHOW');
  });

  it('leaves future appointments untouched', async () => {
    const { processed, store, outbox } = await runWith(
      [bookedAppointment('a4', date, startTime)],
      new Date(start.getTime() - 60 * MIN),
    );
    expect(processed).toBe(0);
    expect(store.get('a4')?.status).toBe(AppointmentStatus.BOOKED);
    expect(outbox).toHaveLength(0);
  });

  it('ignores non-BOOKED rows and is idempotent across reruns', async () => {
    const cancelled = bookedAppointment('a5', date, startTime);
    cancelled.status = AppointmentStatus.CANCELLED;
    const { dataSource, store, outbox } = buildDataSource([
      bookedAppointment('a6', date, startTime),
      cancelled,
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompleteAppointmentsUseCase,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    const useCase = module.get(CompleteAppointmentsUseCase);
    const now = new Date(start.getTime() + 10 * MIN);

    expect(await useCase.execute(now)).toBe(1);
    const completedAt = store.get('a6')?.completedAt;
    expect(await useCase.execute(now)).toBe(0);
    expect(store.get('a6')?.completedAt).toEqual(completedAt);
    expect(outbox).toHaveLength(1);
    expect(store.get('a5')?.status).toBe(AppointmentStatus.CANCELLED);
    expect(OutboxEventEntity).toBeDefined();
  });
});
