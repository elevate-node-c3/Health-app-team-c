import { DateTime } from 'luxon';
import { DataSource, EntityManager } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RescheduleAppointmentUseCase } from './reschedule-appointment.use-case';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import {
  CancellationDecision,
  decideCancellation,
} from '../policies/cancellation-policy';
import { getAppointmentStart } from '../helpers/appiontment-time';

const ZONE = 'Africa/Cairo';

function cairoDateTime(hoursInFuture: number) {
  return DateTime.now().setZone(ZONE).plus({ hours: hoursInFuture });
}

function fullPairing() {
  const days: Record<string, unknown> = {};
  for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    days[d] = { start: '00:00', end: '24:00' };
  }
  return {
    doctorId: 'doc-1',
    clinicId: 'clinic-1',
    isActive: true,
    doctor: { isActive: true, isVerified: true },
    clinic: { isActive: true },
    schedule: { ...days, slotDuration: 30, leaves: [] as string[] },
  };
}

describe('RescheduleAppointmentUseCase', () => {
  let useCase: RescheduleAppointmentUseCase;
  let manager: jest.Mocked<EntityManager>;
  let savedAppointment: AppointmentEntity | null;
  let savedEvents: Array<{ eventType: string; payload: Record<string, unknown> }>;
  let appointmentRow: AppointmentEntity | null;
  let sameDayRows: AppointmentEntity[];
  let holdRows: Array<{ startTime: string; expiresAt: Date }>;
  let saveError: unknown = null;
  let pairingOverride: ReturnType<typeof fullPairing> | null;

  beforeEach(() => {
    savedAppointment = null;
    savedEvents = [];
    appointmentRow = null;
    sameDayRows = [];
    holdRows = [];
    saveError = null;
    pairingOverride = null;

    const appointmentQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => appointmentRow),
      getMany: jest.fn(async () => sameDayRows),
    };
    const holdQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => holdRows),
    };

    manager = {
      getRepository: jest.fn((entity: unknown) => {
        const name = (entity as { name?: string }).name ?? '';
        if (name === 'AppointmentEntity') {
          return {
            createQueryBuilder: jest.fn(() => appointmentQb),
            save: jest.fn(async (e: AppointmentEntity) => {
              if (saveError) throw saveError;
              savedAppointment = e;
              return e;
            }),
          };
        }
        if (name === 'DoctorClinicEntity') {
          return {
            findOne: jest.fn(async () => pairingOverride ?? fullPairing()),
          };
        }
        if (name === 'SlotHoldEntity') {
          return { createQueryBuilder: jest.fn(() => holdQb) };
        }
        return {
          save: jest.fn(async (e: { eventType: string; payload: Record<string, unknown> }) => {
            savedEvents.push(e);
            return e;
          }),
        };
      }),
    } as unknown as jest.Mocked<EntityManager>;

    const dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) =>
        cb(manager),
      ),
    } as unknown as DataSource;

    useCase = new RescheduleAppointmentUseCase(dataSource);
  });

  function bookableRow(hoursInFuture: number) {
    const dt = cairoDateTime(hoursInFuture);
    const snapped = dt.set({
      minute: dt.minute < 30 ? 0 : 30,
      second: 0,
      millisecond: 0,
    });
    const start = snapped.toFormat('HH:mm');
    const end = snapped.plus({ minutes: 30 }).toFormat('HH:mm');
    return {
      id: 'app-1',
      doctorId: 'doc-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      date: dt.toFormat('yyyy-MM-dd'),
      startTime: start,
      endTime: end,
      status: AppointmentStatus.BOOKED,
      rescheduleCount: 0,
    } as AppointmentEntity;
  }

  it('moves a 48h appointment to a free slot and publishes the event', async () => {
    appointmentRow = bookableRow(48);
    const oldStart = appointmentRow.startTime;
    const target = cairoDateTime(72);

    const result = await useCase.execute('app-1', 'patient-1', {
      date: target.toFormat('yyyy-MM-dd'),
      newStartTime: '11:00',
    });

    expect(result.appointmentId).toBe('app-1');
    expect(result.date).toBe(target.toFormat('yyyy-MM-dd'));
    expect(result.startTime).toBe('11:00');
    expect(result.endTime).toBe('11:30');
    expect(result.rescheduleCount).toBe(1);
    expect(savedAppointment?.date).toBe(target.toFormat('yyyy-MM-dd'));
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].eventType).toBe('APPOINTMENT_RESCHEDULED');
    expect(savedEvents[0].payload['oldStartTime']).toBe(oldStart);
    expect(savedEvents[0].payload['rescheduleCount']).toBe(1);
  });

  it('refuses inside 24h with 422', async () => {
    appointmentRow = bookableRow(6);

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: cairoDateTime(30).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('refuses a second reschedule with 409', async () => {
    appointmentRow = { ...bookableRow(48), rescheduleCount: 1 };

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('treats legacy null rescheduleCount as 0', async () => {
    appointmentRow = {
      ...bookableRow(48),
      rescheduleCount: null as unknown as number,
    };

    const result = await useCase.execute('app-1', 'patient-1', {
      date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
      newStartTime: '11:00',
    });

    expect(result.rescheduleCount).toBe(1);
  });

  it('returns 404 for another user', async () => {
    appointmentRow = bookableRow(48);

    await expect(
      useCase.execute('app-1', 'other-patient', {
        date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses cancelled appointments', async () => {
    appointmentRow = {
      ...bookableRow(48),
      status: AppointmentStatus.CANCELLED,
    };

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses the same slot with a dedicated code', async () => {
    appointmentRow = bookableRow(48);

    const err = await useCase
      .execute('app-1', 'patient-1', {
        date: appointmentRow.date,
        newStartTime: appointmentRow.startTime,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as { response: { code: string } }).response.code).toBe(
      'BOOKING_RESCHEDULE_SAME_SLOT',
    );
  });

  it('refuses a slot taken by another booking', async () => {
    appointmentRow = bookableRow(48);
    const targetDate = cairoDateTime(72).toFormat('yyyy-MM-dd');
    sameDayRows = [
      {
        id: 'app-2',
        status: AppointmentStatus.BOOKED,
        startTime: '11:00',
      } as AppointmentEntity,
    ];

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: targetDate,
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(ConflictException);
    expect(savedAppointment).toBeNull();
  });

  it('refuses a slot with a live hold', async () => {
    appointmentRow = bookableRow(48);
    const targetDate = cairoDateTime(72).toFormat('yyyy-MM-dd');
    holdRows = [
      {
        startTime: '11:00',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    ];

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: targetDate,
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(ConflictException);
    expect(savedAppointment).toBeNull();
  });

  it('maps unique violation to 409 with original intact', async () => {
    appointmentRow = bookableRow(48);
    saveError = { code: '23505' };

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(ConflictException);
    expect(savedEvents).toHaveLength(0);
  });

  it('closes the D2 loophole: 30h+ moved to 2h-away, cancel on NEW start is NO_REFUND', async () => {
    appointmentRow = bookableRow(30);
    const rawTarget = cairoDateTime(2);
    const target = rawTarget.set({
      minute: rawTarget.minute < 30 ? 0 : 30,
      second: 0,
      millisecond: 0,
    });

    const result = await useCase.execute('app-1', 'patient-1', {
      date: target.toFormat('yyyy-MM-dd'),
      newStartTime: target.toFormat('HH:mm'),
    });

    expect(result.rescheduleCount).toBe(1);
    const movedStart = getAppointmentStart({
      date: result.date,
      startTime: result.startTime,
    });
    expect(decideCancellation(movedStart, new Date())).toBe(
      CancellationDecision.NO_REFUND,
    );
  });

  it('refuses a past new slot with 409 and leaves the original intact', async () => {
    appointmentRow = bookableRow(48);
    const past = cairoDateTime(-26);

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: past.toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(ConflictException);
    expect(savedAppointment).toBeNull();
    expect(savedEvents).toHaveLength(0);
  });

  it('refuses a leave date with 404', async () => {
    appointmentRow = bookableRow(48);
    const targetDate = cairoDateTime(72).toFormat('yyyy-MM-dd');
    const pairing = fullPairing();
    pairing.schedule.leaves = [targetDate];
    pairingOverride = pairing;

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: targetDate,
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(savedAppointment).toBeNull();
  });

  it('refuses COMPLETED appointments with 400', async () => {
    appointmentRow = {
      ...bookableRow(48),
      status: AppointmentStatus.COMPLETED,
    };

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses already-started appointments with 400', async () => {
    appointmentRow = bookableRow(-2);

    await expect(
      useCase.execute('app-1', 'patient-1', {
        date: cairoDateTime(72).toFormat('yyyy-MM-dd'),
        newStartTime: '11:00',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
