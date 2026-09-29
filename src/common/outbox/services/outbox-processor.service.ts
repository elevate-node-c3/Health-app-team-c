import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { OutboxEventEntity, OutboxEventStatus } from '../entities/outbox-event.entity';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AlertService } from './alert.service';

const MAX_RETRY_ATTEMPTS = 10;

@Injectable()
export class OutboxProcessorService {
    private readonly logger = new Logger(OutboxProcessorService.name);

    constructor(
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepository: Repository<OutboxEventEntity>,
        private readonly dataSource: DataSource,
        private readonly amqpConnection: AmqpConnection,
        private readonly alertService: AlertService,
    ) { }

    async triggerPublish(eventId: string, manager?: EntityManager) {
        const repo = manager
            ? manager.getRepository(OutboxEventEntity)
            : this.outboxRepository;

        const event = await repo.findOne({ where: { id: eventId, isProcessed: false } });
        if (!event) return;

        if (!event.exchange) {
            this.logger.error(
                `Event ${event.id} (${event.eventType}) has no exchange set — skipping publish. This is a bug at the publish site.`,
            );
            return;
        }

        try {
            await this.amqpConnection.publish(
                event.exchange,
                event.eventType,
                event.payload,
                { headers: { 'x-event-id': event.id } },
            );

            this.logger.log(
                `Successfully published event: ${event.eventType} to exchange [${event.exchange}] (ID: ${event.id})`,
            );

            event.isProcessed = true;
            event.status = OutboxEventStatus.PROCESSED;
            await repo.save(event);
        } catch (error: any) {
            const newRetryCount = (event.retryCount || 0) + 1;

            if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
                await repo.update(event.id, {
                    retryCount: newRetryCount,
                    status: OutboxEventStatus.FAILED_PERMANENTLY,
                    lastFailureAt: new Date(),
                });

                this.logger.error(
                    `Event ${event.id} permanently failed after ${newRetryCount} attempts: ${error.message}`,
                );

                await this.alertService.notifyPermanentFailure({
                    eventId: event.id,
                    eventType: event.eventType,
                    exchange: event.exchange,
                    retryCount: newRetryCount,
                    lastError: error.message,
                });
            } else {
                await repo.update(event.id, {
                    retryCount: newRetryCount,
                    lastFailureAt: new Date(),
                });

                this.logger.error(
                    `Failed to publish event ID ${event.id} (attempt ${newRetryCount}/${MAX_RETRY_ATTEMPTS}): ${error.message}`,
                );
            }
        }
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async processPendingOutboxEvents() {
        let claimedIds: string[] = [];

        try {
            const rawEvents: { id: string }[] = await this.dataSource.query(
                `SELECT id FROM outbox_events
                 WHERE "isProcessed" = false
                   AND "status" != 'FAILED_PERMANENTLY'
                 ORDER BY "createdAt" ASC
                 LIMIT 10
                 FOR UPDATE SKIP LOCKED`,
            );

            claimedIds = rawEvents.map((r) => r.id);
        } catch (dbError: any) {
            this.logger.error(
                `Error while fetching outbox events in fallback cron: ${dbError.message}`,
            );
            return;
        }

        if (claimedIds.length === 0) return;

        for (const id of claimedIds) {
            await this.triggerPublish(id);
        }
    }
}