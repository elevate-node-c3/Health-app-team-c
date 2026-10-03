import { AppointmentReminderService } from '../services/appointment-reminder.service';
import { AppointmentReminderEntity, ReminderStatus } from '../entities/appointment-reminder.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';

function buildManager() {
  const store = new Map<string, AppointmentReminderEntity>();
  const repo = {
    findOne: jest.fn(async ({ where }: { where: { appointmentId: string } }) => store.get(where.appointmentId) ?? null),
    create: jest.fn((dto: Partial<AppointmentReminderEntity>) => ({ ...dto }) as AppointmentReminderEntity),
    save: jest.fn(async (entity: AppointmentReminderEntity) => {
      const saved = { ...entity, id: entity.id ?? `rem-${store.size + 1}` };
      store.set(saved.appointmentId, saved as AppointmentReminderEntity);
      return saved as AppointmentReminderEntity;
    }),
    update: jest.fn(async (criteria: { appointmentId: string; status: ReminderStatus }, partial: Partial<AppointmentReminderEntity>) => {
      const current = store.get(criteria.appointmentId);
      if (current && current.status === criteria.status) Object.assign(current, partial);
      return { affected: 1 };
    }),
  };
  const manager = { getRepository: jest.fn(() => repo) };
  return { manager, store };
}

describe('Reminder lifecycle integration', () => {
  const service = new AppointmentReminderService();
  const date = '2026-10-05';
  const startTime = '15:00:00';
  const start = getAppointmentStart({ date, startTime });

  it('book schedules reminder and cancel silences it', async () => {
    const { manager, store } = buildManager();
    const bookNow = new Date(start.getTime() - 48 * 60 * 60 * 1000);
    await service.scheduleForBooking(
      manager as never,
      {
        appointmentId: 'appt-book',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        clinicId: 'clinic-1',
        date,
        startTime,
      },
      bookNow,
    );
    expect(store.get('appt-book')?.status).toBe(ReminderStatus.PENDING);
    expect(store.get('appt-book')?.remindAt).toEqual(
      new Date(start.getTime() - 24 * 60 * 60 * 1000),
    );

    await service.cancelForAppointment(manager as never, 'appt-book');
    expect(store.get('appt-book')?.status).toBe(ReminderStatus.CANCELLED);
    const pendingLeft = Array.from(store.values()).filter((r) => r.status === ReminderStatus.PENDING);
    expect(pendingLeft).toHaveLength(0);
  });

  it('move leaves only the new reminder firing', async () => {
    const { manager, store } = buildManager();
    const bookNow = new Date(start.getTime() - 48 * 60 * 60 * 1000);
    await service.scheduleForBooking(
      manager as never,
      {
        appointmentId: 'appt-old',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        clinicId: 'clinic-1',
        date,
        startTime,
      },
      bookNow,
    );
    await service.moveForReschedule(
      manager as never,
      'appt-old',
      {
        appointmentId: 'appt-new',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        clinicId: 'clinic-1',
        date: '2026-10-06',
        startTime: '11:00:00',
      },
      bookNow,
    );
    expect(store.get('appt-old')?.status).toBe(ReminderStatus.CANCELLED);
    expect(store.get('appt-new')?.status).toBe(ReminderStatus.PENDING);
  });
});
