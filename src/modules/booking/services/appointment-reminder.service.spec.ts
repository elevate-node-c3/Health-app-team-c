import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentReminderEntity, ReminderStatus } from '../entities/appointment-reminder.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';

function buildManager(existing: AppointmentReminderEntity[] = []) {
  const store = new Map<string, AppointmentReminderEntity>();
  for (const r of existing) store.set(r.appointmentId, { ...r });
  const repo = {
    findOne: jest.fn(async ({ where }: { where: { appointmentId: string } }) =>
      store.get(where.appointmentId) ?? null,
    ),
    create: jest.fn((dto: Partial<AppointmentReminderEntity>) => ({ ...dto }) as AppointmentReminderEntity),
    save: jest.fn(async (entity: AppointmentReminderEntity) => {
      const saved = { ...entity, id: entity.id ?? `rem-${store.size + 1}` };
      store.set(saved.appointmentId, saved as AppointmentReminderEntity);
      return saved as AppointmentReminderEntity;
    }),
    update: jest.fn(async (criteria: object, partial: object) => {
      const c = criteria as { appointmentId: string; status: ReminderStatus };
      const current = store.get(c.appointmentId);
      if (current && current.status === c.status) {
        Object.assign(current, partial);
      }
      return { affected: 1 };
    }),
  };
  const manager = { getRepository: jest.fn(() => repo) };
  return { manager, store, repo };
}

describe('AppointmentReminderService', () => {
  const service = new AppointmentReminderService();
  const date = '2026-10-02';
  const startTime = '10:00:00';
  const start = getAppointmentStart({ date, startTime });

  const input = {
    appointmentId: 'appt-1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    clinicId: 'clinic-1',
    date,
    startTime,
  };

  it('schedules one reminder at Cairo start minus 24h', async () => {
    const { manager, store } = buildManager();
    const now = new Date(start.getTime() - 48 * 60 * 60 * 1000);
    const saved = await service.scheduleForBooking(manager as never, input, now);
    expect(saved.status).toBe(ReminderStatus.PENDING);
    expect(saved.remindAt).toEqual(new Date(start.getTime() - 24 * 60 * 60 * 1000));
    expect(store.get('appt-1')?.status).toBe(ReminderStatus.PENDING);
  });

  it('creates immediate PENDING when remindAt already passed', async () => {
    const { manager } = buildManager();
    const now = new Date(start.getTime() - 60 * 60 * 1000);
    const saved = await service.scheduleForBooking(manager as never, input, now);
    expect(saved.status).toBe(ReminderStatus.PENDING);
  });

  it('returns existing row on duplicate schedule', async () => {
    const { manager, repo } = buildManager();
    const now = new Date(start.getTime() - 48 * 60 * 60 * 1000);
    await service.scheduleForBooking(manager as never, input, now);
    const second = await service.scheduleForBooking(manager as never, input, now);
    expect(second.appointmentId).toBe('appt-1');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('cancels PENDING to CANCELLED', async () => {
    const existing = new AppointmentReminderEntity();
    existing.id = 'rem-1';
    existing.appointmentId = 'appt-1';
    existing.status = ReminderStatus.PENDING;
    const { manager, store } = buildManager([existing]);
    await service.cancelForAppointment(manager as never, 'appt-1');
    expect(store.get('appt-1')?.status).toBe(ReminderStatus.CANCELLED);
  });

  it('move cancels old and inserts new atomically', async () => {
    const old = new AppointmentReminderEntity();
    old.id = 'rem-old';
    old.appointmentId = 'appt-old';
    old.status = ReminderStatus.PENDING;
    const { manager, store } = buildManager([old]);
    const next = { ...input, appointmentId: 'appt-new' };
    await service.moveForReschedule(manager as never, 'appt-old', next, new Date());
    expect(store.get('appt-old')?.status).toBe(ReminderStatus.CANCELLED);
    expect(store.get('appt-new')?.status).toBe(ReminderStatus.PENDING);
  });
});
