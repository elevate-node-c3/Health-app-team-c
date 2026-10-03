import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DateTime } from 'luxon';
import {
  AppointmentEntity,
  AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { DoctorClinicEntity } from 'src/modules/catalog/entities/doctor-clinic.entity';
import {
  SlotHoldEntity,
  SlotHoldStatus,
} from 'src/modules/booking/entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import {
  CancellationDecision,
  decideCancellation,
} from '../policies/cancellation-policy';
import { getAppointmentStart, CLINIC_TZ } from '../helpers/appiontment-time';
import { RescheduleAppointmentDto } from '../dto/reschedule-appointment.dto';

const BOOKING_WINDOW_DAYS = 60;

@Injectable()
export class RescheduleAppointmentUseCase {
  constructor(private readonly dataSource: DataSource) {}

  async execute(
    appointmentId: string,
    patientId: string,
    dto: RescheduleAppointmentDto,
  ) {
    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      const appointment = await manager
        .getRepository(AppointmentEntity)
        .createQueryBuilder('app')
        .setLock('pessimistic_write')
        .where('app.id = :id', { id: appointmentId })
        .getOne();

      if (!appointment || appointment.patientId !== patientId) {
        throw new NotFoundException({
          code: 'BOOKING_APPOINTMENT_NOT_FOUND',
          messageKey: 'errors.booking.appointment_not_found',
        });
      }

      if (appointment.status !== AppointmentStatus.BOOKED) {
        throw new BadRequestException({
          code: 'BOOKING_RESCHEDULE_NOT_ALLOWED',
          messageKey: 'errors.booking.reschedule_not_allowed',
        });
      }

      const decision = decideCancellation(
        getAppointmentStart(appointment),
        now,
      );
      if (decision === CancellationDecision.ALREADY_STARTED) {
        throw new BadRequestException({
          code: 'BOOKING_RESCHEDULE_NOT_ALLOWED',
          messageKey: 'errors.booking.reschedule_not_allowed',
        });
      }
      if (decision !== CancellationDecision.FREE) {
        throw new UnprocessableEntityException({
          code: 'BOOKING_RESCHEDULE_TOO_LATE',
          messageKey: 'errors.booking.reschedule_too_late',
        });
      }

      if ((appointment.rescheduleCount ?? 0) >= 1) {
        throw new ConflictException({
          code: 'BOOKING_RESCHEDULE_ALREADY_USED',
          messageKey: 'errors.booking.reschedule_already_used',
        });
      }

      const pairing = await manager.getRepository(DoctorClinicEntity).findOne({
        where: {
          doctorId: appointment.doctorId,
          clinicId: appointment.clinicId,
        },
        relations: ['doctor', 'clinic'],
      });
      if (
        !pairing ||
        !pairing.isActive ||
        !pairing.doctor.isActive ||
        !pairing.doctor.isVerified ||
        !pairing.clinic.isActive
      ) {
        throw new NotFoundException({
          code: 'BOOKING_SLOT_NOT_FOUND',
          messageKey: 'errors.booking.slot_not_found',
        });
      }

      const slotDuration = this.assertNewSlotValid(pairing, dto);

      const newStart = dto.newStartTime;
      const newStartFull =
        newStart.length === 5 ? `${newStart}:00` : newStart;
      const oldStartFull =
        appointment.startTime.length === 5
          ? `${appointment.startTime}:00`
          : appointment.startTime;

      if (dto.date === appointment.date && newStartFull === oldStartFull) {
        throw new BadRequestException({
          code: 'BOOKING_RESCHEDULE_SAME_SLOT',
          messageKey: 'errors.booking.reschedule_same_slot',
        });
      }

      const sameDayAppointments = await manager
        .getRepository(AppointmentEntity)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where(
          'a."doctorId" = :doctorId AND a."clinicId" = :clinicId AND a.date = :date',
          {
            doctorId: appointment.doctorId,
            clinicId: appointment.clinicId,
            date: dto.date,
          },
        )
        .getMany();
      const taken = sameDayAppointments.some(
        (a) =>
          a.id !== appointment.id &&
          a.status === AppointmentStatus.BOOKED &&
          a.startTime.substring(0, 5) === newStart,
      );
      if (taken) {
        throw new ConflictException({
          code: 'BOOKING_SLOT_UNAVAILABLE',
          messageKey: 'errors.booking.slot_unavailable',
        });
      }

      const holds = await manager
        .getRepository(SlotHoldEntity)
        .createQueryBuilder('h')
        .setLock('pessimistic_write')
        .where(
          'h."doctorId" = :doctorId AND h."clinicId" = :clinicId AND h.date = :date AND h.status = :status',
          {
            doctorId: appointment.doctorId,
            clinicId: appointment.clinicId,
            date: dto.date,
            status: SlotHoldStatus.ACTIVE,
          },
        )
        .getMany();
      const held = holds.some(
        (h) =>
          h.startTime.substring(0, 5) === newStart &&
          new Date(h.expiresAt).getTime() > now.getTime(),
      );
      if (held) {
        throw new ConflictException({
          code: 'BOOKING_SLOT_UNAVAILABLE',
          messageKey: 'errors.booking.slot_unavailable',
        });
      }

      const oldDate = appointment.date;
      const oldStartTime = appointment.startTime.substring(0, 5);

      appointment.date = dto.date;
      appointment.startTime = newStart;
      appointment.endTime = this.addMinutes(newStart, slotDuration);
      appointment.rescheduleCount = (appointment.rescheduleCount ?? 0) + 1;
      appointment.rescheduledAt = now;

      try {
        await manager.getRepository(AppointmentEntity).save(appointment);
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          (err as { code?: string }).code === '23505'
        ) {
          throw new ConflictException({
            code: 'BOOKING_SLOT_UNAVAILABLE',
            messageKey: 'errors.booking.slot_unavailable',
          });
        }
        throw err;
      }

      await manager.getRepository(OutboxEventEntity).save({
        aggregateType: 'APPOINTMENT',
        exchange: 'appointment_exchange',
        eventType: 'APPOINTMENT_RESCHEDULED',
        payload: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          clinicId: appointment.clinicId,
          oldDate,
          oldStartTime,
          date: appointment.date,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          rescheduleCount: appointment.rescheduleCount,
          rescheduledAt: now,
        },
        isProcessed: false,
      });

      return {
        appointmentId: appointment.id,
        oldDate,
        oldStartTime,
        date: appointment.date,
        startTime: appointment.startTime.substring(0, 5),
        endTime: appointment.endTime.substring(0, 5),
        rescheduleCount: appointment.rescheduleCount,
        rescheduledAt: now,
      };
    });
  }

  private assertNewSlotValid(
    pairing: DoctorClinicEntity,
    dto: RescheduleAppointmentDto,
  ): number {
    const now = this.cairoNow();
    const parsed = DateTime.fromISO(dto.date, { zone: CLINIC_TZ });
    if (!parsed.isValid) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.invalid_slot',
      });
    }
    const targetWeekday = parsed.weekday % 7;

    const todayStr = this.toDateStr(now);
    if (dto.date < todayStr) {
      throw new ConflictException({
        code: 'BOOKING_SLOT_UNAVAILABLE',
        messageKey: 'errors.booking.slot_unavailable',
      });
    }
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + BOOKING_WINDOW_DAYS);
    if (dto.date > this.toDateStr(maxDate)) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.invalid_slot',
      });
    }

    if (dto.date === todayStr) {
      const [sh, sm] = dto.newStartTime.split(':').map(Number);
      if (sh * 60 + sm <= now.getHours() * 60 + now.getMinutes()) {
        throw new ConflictException({
          code: 'BOOKING_SLOT_UNAVAILABLE',
          messageKey: 'errors.booking.slot_unavailable',
        });
      }
    }

    const dayTokens = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const schedule = pairing.schedule || {};
    const daySchedule = schedule[dayTokens[targetWeekday]];
    const isLeave = schedule.leaves && schedule.leaves.includes(dto.date);
    if (!daySchedule || isLeave) {
      throw new NotFoundException({
        code: 'BOOKING_SLOT_NOT_FOUND',
        messageKey: 'errors.booking.slot_not_found',
      });
    }

    const slotDuration = schedule.slotDuration || 30;
    const validSlots = this.generateSlots(
      daySchedule.start || '09:00',
      daySchedule.end || '17:00',
      slotDuration,
    );
    if (!validSlots.includes(dto.newStartTime)) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.invalid_slot',
      });
    }
    return slotDuration;
  }

  private cairoNow(): Date {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
    );
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private generateSlots(start: string, end: string, durationMin: number): string[] {
    const slots: string[] = [];
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    let current = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    while (current + durationMin <= endTotal) {
      slots.push(
        `${String(Math.floor(current / 60)).padStart(2, '0')}:${String(current % 60).padStart(2, '0')}`,
      );
      current += durationMin;
    }
    return slots;
  }

  private addMinutes(time: string, minutes: number): string {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
}
