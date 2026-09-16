import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ProcessedEventEntity } from '../../../common/outbox/entities/processed-event.entity';
import { SendNotificationUseCase } from '../use-case/send-notification.use-case';


@Injectable()
export class FavoriteNotificationConsumer {
    private readonly logger = new Logger(FavoriteNotificationConsumer.name);

    constructor(
        private readonly sendNotificationUseCase: SendNotificationUseCase,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedRepo: Repository<ProcessedEventEntity>,
    ) { }

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'doctor.favorited',
        queue: 'favorite_notifications_queue',
    })
    async handleFavorited(
        msg: { userId: string; doctorId: string; doctorName?: string },
        amqpMsg: ConsumeMessage,
    ) {
        const eventId = amqpMsg?.properties?.headers?.['x-event-id'] as string | undefined;

        if (eventId) {
            try {
                await this.processedRepo.insert({ eventId, eventType: 'doctor.favorited' });
            } catch {
                this.logger.warn(`[Idempotency] Event ${eventId} already processed — skipping duplicate notification.`);
                return;
            }
        }

        try {
            const name = msg.doctorName || 'Doctor';

            await this.sendNotificationUseCase.execute({
                userId: msg.userId,
                title: 'Added to favorites',
                message: `Dr. ${name} has been added to favorite`,
            });

            this.logger.log(`Notification created for user ${msg.userId} via RabbitMQ`);
        } catch (err: any) {
            this.logger.error(`Favorite notification failed for ${msg.userId}/${msg.doctorId}: ${err.message}`);
        }
    }
}