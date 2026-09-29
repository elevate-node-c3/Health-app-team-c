import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SlotHoldEntity,
  SlotHoldStatus,
} from '../entities/slot-hold.entity';

@Injectable()
export class ExtendHoldUseCase {
  constructor(
    @InjectRepository(SlotHoldEntity)
    private readonly holdRepo: Repository<SlotHoldEntity>,
  ) {}

  async execute(patientId: string, holdId: string) {
    const hold = await this.holdRepo.findOne({ where: { id: holdId } });

    if (!hold || hold.patientId !== patientId) {
      throw new NotFoundException({
        code: 'BOOKING_HOLD_NOT_FOUND',
        messageKey: 'errors.booking.hold_not_found',
      });
    }

    if (
      hold.status !== SlotHoldStatus.ACTIVE ||
      new Date(hold.expiresAt).getTime() <= Date.now()
    ) {
      throw new ConflictException({
        code: 'BOOKING_HOLD_EXPIRED',
        messageKey: 'errors.booking.hold_expired',
      });
    }

    if (hold.extendedOnce) {
      throw new ConflictException({
        code: 'BOOKING_HOLD_EXTENSION_ALREADY_USED',
        messageKey: 'errors.booking.hold_extension_already_used',
      });
    }

    hold.expiresAt = new Date(new Date(hold.expiresAt).getTime() + 5 * 60 * 1000);
    hold.extendedOnce = true;
    await this.holdRepo.save(hold);

    return {
      message: 'booking.hold_extended',
      data: {
        holdId: hold.id,
        expiresAt: hold.expiresAt.toISOString(),
        extendedOnce: true,
      },
    };
  }
}
