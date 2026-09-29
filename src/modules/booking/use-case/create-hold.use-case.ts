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

const HOLD_TTL_MINUTES = 10;
const BOOKING_WINDOW_DAYS = 60;

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
    const pairing = await this.loadActivePairing(dto.doctorId, dto.clinicId);
    const now = this.cairoNow();
    const slotDuration = this.assertSlotAligns(pairing, dto);
    this.assertWithinWindow(dto.date, now);
    this.assertNotPastToday(dto, now);
    await this.assertNotBooked(dto);

    const frozenFee = Number(pairing.consultationFee);
    const endTime = this.addMinutes(dto.startTime, slotDuration);
    const expiresAt = new Date(Date.now() + HOLD_TTL_MINUTES * 60 * 1000);

    const { holdId, eventId } = await this.insertHoldWithOutbox(
      patientId,
      dto,
      endTime,
      frozenFee,
      expiresAt,
    );

    if (eventId) {
      setImmediate(() => {
        this.outboxProcessor.triggerPublish(eventId).catch((err: Error) => {
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

  private async loadActivePairing(doctorId: string, clinicId: string) {
    const pairing = await this.doctorClinicRepo.findOne({
      where: { doctorId, clinicId },
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

    return pairing;
  }

  private assertWithinWindow(date: string, now: Date) {
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.invalid_slot',
      });
    }

    const todayStr = this.toDateStr(now);
    if (date < todayStr) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.slot_in_past',
      });
    }

    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + BOOKING_WINDOW_DAYS);
    if (date > this.toDateStr(maxDate)) {
      throw new BadRequestException({
        code: 'BOOKING_INVALID_SLOT',
        messageKey: 'errors.booking.slot_too_far',
      });
    }
  }

  private assertSlotAligns(
    pairing: DoctorClinicEntity,
    dto: CreateHoldDto,
  ): number {
    const targetDate = new Date(dto.date);
    const dayTokens = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const schedule = pairing.schedule || {};
    const daySchedule = schedule[dayTokens[targetDate.getDay()]];
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

    return slotDuration;
  }

  private assertNotPastToday(dto: CreateHoldDto, now: Date) {
    if (dto.date !== this.toDateStr(now)) return;
    const [sh, sm] = dto.startTime.split(':').map(Number);
    if (sh * 60 + sm <= now.getHours() * 60 + now.getMinutes()) {
      throw new ConflictException({
        code: 'BOOKING_SLOT_UNAVAILABLE',
        messageKey: 'errors.booking.slot_unavailable',
      });
    }
  }

  private async assertNotBooked(dto: CreateHoldDto) {
    const startTime =
      dto.startTime.length === 5 ? `${dto.startTime}:00` : dto.startTime;
    const existing = await this.appointmentRepo.findOne({
      where: {
        doctorId: dto.doctorId,
        clinicId: dto.clinicId,
        date: dto.date,
        startTime,
      },
    });

    if (existing && existing.status !== AppointmentStatus.CANCELLED) {
      throw new ConflictException({
        code: 'BOOKING_SLOT_UNAVAILABLE',
        messageKey: 'errors.booking.slot_unavailable',
      });
    }
  }

  private async insertHoldWithOutbox(
    patientId: string,
    dto: CreateHoldDto,
    endTime: string,
    frozenFee: number,
    expiresAt: Date,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

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
      const savedEvent = await queryRunner.manager.save(event);

      await queryRunner.commitTransaction();
      return { holdId: saved.id as string, eventId: savedEvent.id as string };
    } catch (err: unknown) {
      await queryRunner.rollbackTransaction();
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
    } finally {
      await queryRunner.release();
    }
  }

  private cairoNow(): Date {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
    );
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private generateSlots(
    start: string,
    end: string,
    durationMin: number,
  ): string[] {
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
