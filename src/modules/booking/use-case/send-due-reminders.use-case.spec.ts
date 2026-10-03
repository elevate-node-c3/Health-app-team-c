import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SendDueRemindersUseCase } from './send-due-reminders.use-case';
import { AppointmentReminderEntity, ReminderStatus } from '../entities/appointment-reminder.entity';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';

function buildDataSource(
  reminders: AppointmentReminderEntity[],
  appointments: AppointmentEntity[],
) {
  const reminderStore = new Map<string, AppointmentReminderEntity>();
  for (const r of reminders) reminderStore.set(r.id, { ...r });
  const appointmentStore = new Map<string, AppointmentEntity>();
  for (const a of appointments) appointmentStore.set(a.id, { ...a });
  const outbox: Record<string, unknown>[] = [];

  const reminderRepo = {
    createQueryBuilder: () => {
      let wantedId = '';
      const qb = {
        setLock: () => qb,
        where: (_: string, params: { id: string }) => {
          wantedId = params.id;
          return qb;
        },
        getOne: async () => reminderStore.get(wantedId) ?? null,
      };
      return qb;
    },
    save: async (entity: AppointmentReminderEntity) => {
      reminderStore.set(entity.id, { ...entity });
      return entity;
    },
  };

  const appointmentRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => appointmentStore.get(where.id) ?? null),
  };

  const outboxRepo = {
    save: jest.fn(async (row: Record<string, unknown>) => {
      const saved = { id: `evt-${outbox.length + 1}`, ...row };
      outbox.push(saved);
      return saved;
    }),
  };

  const dataSource = {
    query: jest.fn(
      async (_sql: string, _params?: unknown[]): Promise<{ id: string }[]> =>
        Array.from(reminderStore.keys()).map((id) => ({ id })),
    ),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<boolean>) => {
      const manager = {
        getRepository: (entity: unknown) => {
          if (entity === AppointmentReminderEntity) return reminderRepo;
          if (entity === AppointmentEntity) return appointmentRepo;
          return outboxRepo;
        },
      };
      return cb(manager);
    }),
  };

  return { dataSource, reminderStore, appointmentStore, outbox };
}

function reminder(id: string, appointmentId: string, remindAt: Date): AppointmentReminderEntity {
  const r = new AppointmentReminderEntity();
  r.id = id;
  r.appointmentId = appointmentId;
  r.patientId = 'patient-1';
  r.doctorId = 'doctor-1';
  r.clinicId = 'clinic-1';
  r.remindAt = remindAt;
  r.status = ReminderStatus.PENDING;
  r.sentAt = null;
  r.eventId = null;
  return r;
}

function booked(id: string, date: string, startTime: string): AppointmentEntity {
  const a = new AppointmentEntity();
  a.id = id;
  a.patientId = 'patient-1';
  a.doctorId = 'doctor-1';
  a.clinicId = 'clinic-1';
  a.date = date;
  a.startTime = startTime;
  a.endTime = '10:30:00';
  a.status = AppointmentStatus.BOOKED;
  return a;
}

describe('SendDueRemindersUseCase', () => {
  const date = '2026-10-02';
  const startTime = '10:00:00';
  const start = getAppointmentStart({ date, startTime });
  const remindAt = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const now = new Date(remindAt.getTime());

  async function runWith(reminders: AppointmentReminderEntity[], appointments: AppointmentEntity[]) {
    const { dataSource, reminderStore, outbox } = buildDataSource(reminders, appointments);
    const module: TestingModule = await Test.createTestingModule({
      providers: [SendDueRemindersUseCase, { provide: DataSource, useValue: dataSource }],
    }).compile();
    return { useCase: module.get(SendDueRemindersUseCase), reminderStore, outbox, dataSource };
  }

  it('sends due reminder once with REMINDER_DUE row', async () => {
    const { useCase, reminderStore, outbox } = await runWith(
      [reminder('r1', 'a1', remindAt)],
      [booked('a1', date, startTime)],
    );
    await expect(useCase.execute(now)).resolves.toBe(1);
    expect(reminderStore.get('r1')?.status).toBe(ReminderStatus.SENT);
    expect(outbox).toHaveLength(1);
    expect((outbox[0] as { eventType: string }).eventType).toBe('REMINDER_DUE');
    expect(OutboxEventEntity).toBeDefined();
  });

  it('skips non-BOOKED and past-start rows as SKIPPED', async () => {
    const cancelled = booked('a2', date, startTime);
    cancelled.status = AppointmentStatus.CANCELLED;
    const { useCase, reminderStore, outbox } = await runWith(
      [reminder('r2', 'a2', remindAt), reminder('r3', 'a3', remindAt)],
      [cancelled, booked('a3', '2026-09-01', '08:00:00')],
    );
    const pastNow = new Date(getAppointmentStart({ date: '2026-09-01', startTime: '08:00:00' }).getTime() + 60000);
    await expect(useCase.execute(pastNow)).resolves.toBe(0);
    expect(reminderStore.get('r2')?.status).toBe(ReminderStatus.SKIPPED);
    expect(reminderStore.get('r3')?.status).toBe(ReminderStatus.SKIPPED);
    expect(outbox).toHaveLength(0);
  });

  it('double run sends once', async () => {
    const { useCase, outbox } = await runWith(
      [reminder('r4', 'a4', remindAt)],
      [booked('a4', date, startTime)],
    );
    await expect(useCase.execute(now)).resolves.toBe(1);
    await expect(useCase.execute(now)).resolves.toBe(0);
    expect(outbox).toHaveLength(1);
  });
});
