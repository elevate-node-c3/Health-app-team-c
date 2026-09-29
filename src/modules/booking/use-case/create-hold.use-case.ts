import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DoctorClinicEntity } from '../../catalog/entities/doctor-clinic.entity';
import {
  AppointmentEntity,
  AppointmentStatus,
} from '../../catalog/entities/appointment.entity';
import { SlotHoldEntity } from '../entities/slot-hold.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { CreateHoldDto } from '../dto/create-hold.dto';

@Injectable()
export class CreateHoldUseCase {
  private readonly logger = new Logger(CreateHoldUseCase.name);

  constructor(
    @InjectRepository(DoctorClinicEntity)
    private readonly doctorClinicRepo: Repository<DoctorClinicEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointmentRepo: Repository<AppointmentEntity>,
    private readonly dataSource: DataSource,
    private readonly outboxProcessor: OutboxProcessorService,
  ) {}

  async execute(patientId: string, dto: CreateHoldDto) {
    const pairing = await this.doctorClinicRepo.findOne({
      where: { doctorId: dto.doctorId, clinicId: dto.clinicId },
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

    const targetDate = new Date(dto.date);
    if (isNaN(targetDate.getTime())) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.invalid_slot',
      });
    }

    const cairoTime = new Date().toLocaleString('en-US', {
      timeZone: 'Africa/Cairo',
    });
    const now = new Date(cairoTime);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (dto.date < todayStr) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.slot_in_past',
      });
    }

    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + 60);
    const maxDateStr = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, '0')}-${String(maxDate.getDate()).padStart(2, '0')}`;
    if (dto.date > maxDateStr) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.slot_too_far',
      });
    }

    const dayTokens = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const targetDay = dayTokens[targetDate.getDay()];
    const schedule = pairing.schedule || {};
    const daySchedule = schedule[targetDay];
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
    if (!validSlots.includes(dto.startTime)) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.invalid_slot',
      });
    }

    if (dto.date === todayStr) {
      const [sh, sm] = dto.startTime.split(':').map(Number);
      if (sh * 60 + sm <= now.getHours() * 60 + now.getMinutes()) {
        throw new ConflictException({
          code: 'BOOKING_SLOT_UNAVAILABLE',
          messageKey: 'errors.booking.slot_unavailable',
        });
      }
    }

    const existingBooking = await this.appointmentRepo.findOne({
      where: {
        doctorId: dto.doctorId,
        clinicId: dto.clinicId,
        date: dto.date,
        startTime: dto.startTime.length === 5 ? `${dto.startTime}:00` : dto.startTime,
      },
    });
    if (
      existingBooking &&
      existingBooking.status !== AppointmentStatus.CANCELLED
    ) {
      throw new ConflictException({
        code: 'BOOKING_SLOT_UNAVAILABLE',
        messageKey: 'errors.booking.slot_unavailable',
      });
    }

    const frozenFee = Number(pairing.consultationFee);
    const endTime = this.addMinutes(dto.startTime, slotDuration);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let holdId: string | undefined;
    let eventId: string | undefined;

    try {
      const hold = queryRunner.manager.create(SlotHoldEntity, {
        doctorId: dto.doctorId,
        clinicId: dto.clinicId,
        patientId,
        date: dto.date,
        startTime: dto.startTime,
        endTime,
        frozenFee,
        expiresAt,
      });
      const saved = await queryRunner.manager.save(hold);
      holdId = saved.id;

      const event = queryRunner.manager.create(OutboxEventEntity, {
        aggregateType: 'SLOT_HOLD',
        eventType: 'slot.held',
        payload: {
          holdId: saved.id,
          patientId,
          doctorId: dto.doctorId,
          clinicId: dto.clinicId,
          date: dto.date,
          startTime: dto.startTime,
          frozenFee: String(frozenFee),
          expiresAt: expiresAt.toISOString(),
        },
        isProcessed: false,
      });
      eventId = (await queryRunner.manager.save(event)).id;

      await queryRunner.commitTransaction();
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      if (err?.code === '23505') {
        throw new ConflictException({
          code: 'BOOKING_SLOT_UNAVAILABLE',
          messageKey: 'errors.booking.slot_unavailable',
        });
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    if (eventId) {
      setImmediate(() => {
        this.outboxProcessor.triggerPublish(eventId!).catch((err) => {
          this.logger.error(
            `Instant outbox publish failed for event ID ${eventId}: ${err.message}`,
          );
        });
      });
    }

    return {
      message: 'booking.hold_created',
      data: {
        holdId,
        doctorId: dto.doctorId,
        clinicId: dto.clinicId,
        date: dto.date,
        startTime: dto.startTime,
        endTime,
        frozenFee: String(frozenFee),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  private generateSlots(start: string, end: string, durationMin: number): string[] {
    const slots: string[] = [];
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    let current = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    while (current + durationMin <= endTotal) {
      const h = Math.floor(current / 60);
      const m = current % 60;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
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
