import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { SlotHoldEntity, SlotHoldStatus } from '../entities/slot-hold.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

@Injectable()
export class ReleaseExpiredHoldsUseCase {
  private readonly logger = new Logger(ReleaseExpiredHoldsUseCase.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async execute(now: Date = new Date()): Promise<number> {
    let claimedIds: string[] = [];

    try {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM slot_holds WHERE status = 'ACTIVE' AND "expiresAt" < $1 ORDER BY "expiresAt" ASC LIMIT 50 FOR UPDATE SKIP LOCKED`,
        [now.toISOString()],
      );
      claimedIds = rows.map((r) => r.id);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Hold release claim failed: ${reason}`);
      return 0;
    }

    if (claimedIds.length === 0) return 0;

    let released = 0;

    for (const id of claimedIds) {
      try {
        const didRelease = await this.dataSource.transaction(async (manager) => {
          const hold = await manager
            .getRepository(SlotHoldEntity)
            .createQueryBuilder('hold')
            .setLock('pessimistic_write')
            .where('hold.id = :id', { id })
            .getOne();

          if (!hold || hold.status !== SlotHoldStatus.ACTIVE) return false;
          if (new Date(hold.expiresAt).getTime() >= now.getTime()) return false;

          hold.status = SlotHoldStatus.EXPIRED;
          await manager.getRepository(SlotHoldEntity).save(hold);

          await manager.getRepository(OutboxEventEntity).save({
            aggregateType: 'SLOT_HOLD',
            exchange: 'appointment_exchange',
            eventType: 'HOLD_EXPIRED',
            payload: {
              holdId: hold.id,
              patientId: hold.patientId,
              doctorId: hold.doctorId,
              clinicId: hold.clinicId,
              date: hold.date,
              startTime:
                typeof hold.startTime === 'string'
                  ? hold.startTime.substring(0, 5)
                  : hold.startTime,
            },
          });

          return true;
        });

        if (didRelease) {
          released += 1;
          this.logger.log(`Hold ${id} expired and released`);
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Release hold ${id} failed: ${reason}`);
      }
    }

    return released;
  }
}
