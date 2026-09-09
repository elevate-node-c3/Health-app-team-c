import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEventEntity } from '../entities/outbox-event.entity';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

@Injectable()
export class OutboxProcessorService {
    private readonly logger = new Logger(OutboxProcessorService.name);

    constructor(
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepository: Repository<OutboxEventEntity>,
        private readonly amqpConnection: AmqpConnection,
    ) { }

    async triggerPublish(eventId: string) {
        const event = await this.outboxRepository.findOne({ where: { id: eventId, isProcessed: false } });
        if (!event) return;

        try {
            await this.amqpConnection.publish(
                'auth_exchange',
                event.eventType,
                event.payload,
                { headers: { 'x-event-id': event.id } },
            );

            this.logger.log(`Successfully published event: ${event.eventType} (ID: ${event.id})`);

            event.isProcessed = true;
            await this.outboxRepository.save(event);
        } catch (error) {
            this.logger.error(`Failed to publish event ID ${event.id}: ${error.message}`);
        }
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async processPendingOutboxEvents() {
        try {
            const events = await this.outboxRepository.find({
                where: { isProcessed: false },
                take: 10,
                order: { createdAt: 'ASC' },
            });

            if (events.length === 0) return;

            for (const event of events) {
                await this.triggerPublish(event.id);
            }
        } catch (dbError) {
            this.logger.error(`Error while fetching outbox events in fallback cron: ${dbError.message}`);
        }
    }
}