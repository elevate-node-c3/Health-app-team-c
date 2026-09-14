import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FavoriteEntity } from '../entities/favorite.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from 'src/common/outbox/services/outbox-processor.service';

@Injectable()
export class RemoveFavoriteUseCase {
    private readonly logger = new Logger(RemoveFavoriteUseCase.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly outboxProcessor: OutboxProcessorService,
    ) { }

    async execute(userId: string, doctorId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let eventId: string | undefined;

        try {
            const result = await queryRunner.manager.delete(FavoriteEntity, { userId, doctorId });

            if (result.affected && result.affected > 0) {
                const event = queryRunner.manager.create(OutboxEventEntity, {
                    aggregateType: 'FAVORITE',
                    eventType: 'doctor.unfavorited',
                    payload: { userId, doctorId },
                    isProcessed: false,
                });
                eventId = (await queryRunner.manager.save(event)).id;
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }

        if (eventId) {
            setImmediate(() => {
                this.outboxProcessor.triggerPublish(eventId!).catch((err) => {
                    this.logger.error(`Instant outbox publish failed for event ID ${eventId}: ${err.message}`);
                });
            });
        }

        return {
            message: 'Doctor removed from favorites',
            data: { doctorId, isFavorite: false },
        };
    }
}
