import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  AppointmentReminderEntity,
  ReminderStatus,
} from '../entities/appointment-reminder.entity';
import { getAppointmentStart } from '../helpers/appiontment-time';

export interface ReminderBookingInput {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  startTime: string;
}

@Injectable()
export class AppointmentReminderService {
  async scheduleForBooking(
    manager: EntityManager,
    input: ReminderBookingInput,
    now: Date = new Date(),
  ): Promise<AppointmentReminderEntity> {
    const repo = manager.getRepository(AppointmentReminderEntity);
    const existing = await repo.findOne({ where: { appointmentId: input.appointmentId } });
    if (existing) return existing;

    const start = getAppointmentStart({ date: input.date, startTime: input.startTime });
    const remindAt = new Date(start.getTime() - 24 * 60 * 60 * 1000);

    const row = repo.create({
      appointmentId: input.appointmentId,
      patientId: input.patientId,
      doctorId: input.doctorId,
      clinicId: input.clinicId,
      remindAt,
      status: ReminderStatus.PENDING,
      sentAt: null,
      eventId: null,
    });

    try {
      return await repo.save(row);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        const raced = await repo.findOne({ where: { appointmentId: input.appointmentId } });
        if (raced) return raced;
      }
      throw err;
    }
  }

  async cancelForAppointment(manager: EntityManager, appointmentId: string): Promise<void> {
    await manager
      .getRepository(AppointmentReminderEntity)
      .update(
        { appointmentId, status: ReminderStatus.PENDING },
        { status: ReminderStatus.CANCELLED },
      );
  }

  async moveForReschedule(
    manager: EntityManager,
    oldAppointmentId: string,
    next: ReminderBookingInput,
    now: Date = new Date(),
  ): Promise<AppointmentReminderEntity> {
    await this.cancelForAppointment(manager, oldAppointmentId);
    return this.scheduleForBooking(manager, next, now);
  }
}
