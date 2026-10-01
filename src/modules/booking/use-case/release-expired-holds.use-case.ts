import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, LessThan } from 'typeorm';
import {
  SlotHoldEntity,
  SlotHoldStatus,
} from '../entities/slot-hold.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

@Injectable()
export class ReleaseExpiredHoldsUseCase {
  private readonly logger = new Logger(ReleaseExpiredHoldsUseCase.name);

  constructor(
    @InjectRepository(SlotHoldEntity)
    private readonly holdRepo: Repository<SlotHoldEntity>,
    private readonly dataSource: DataSource,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE)
  async execute(): Promise<number> {
    const expired = await this.holdRepo.find({
      where: {
        status: SlotHoldStatus.ACTIVE,
        expiresAt: LessThan(new Date()),
      },
      take: 50,
      order: { expiresAt: 'ASC' },
    });

    if (expired.length === 0) return 0;

    for (const hold of expired) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        const fresh = await queryRunner.manager.findOne(SlotHoldEntity, {
          where: { id: hold.id, status: SlotHoldStatus.ACTIVE },
        });
        if (!fresh || new Date(fresh.expiresAt).getTime() >= Date.now()) {
          await queryRunner.rollbackTransaction();
          continue;
        }

        fresh.status = SlotHoldStatus.EXPIRED;
        await queryRunner.manager.save(fresh);

        queryRunner.manager.create(OutboxEventEntity, {
          aggregateType: 'SLOT_HOLD',
          aggregateId: fresh.id,
          exchange: 'appointment_exchange',
          eventType: 'hold.expired',
          payload: {
            holdId: fresh.id,
            patientId: fresh.patientId,
            doctorId: fresh.doctorId,
            clinicId: fresh.clinicId,
            date: fresh.date,
            startTime: fresh.startTime.substring(0, 5),
          },
          isProcessed: false,
        }),

          await queryRunner.commitTransaction();
      } catch (err: unknown) {
        await queryRunner.rollbackTransaction();
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Release hold ${hold.id} failed: ${reason}`);
      } finally {
        await queryRunner.release();
      }
    }

    return expired.length;
  }
}
