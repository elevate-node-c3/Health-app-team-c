import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { DoctorEntity } from '../entities/doctor.entity';
import { NotificationEntity } from '../entities/notification.entity';
import { ProcessedEventEntity } from '../../../common/outbox/entities/processed-event.entity';

@Injectable()
export class FavoriteNotificationConsumer {
    private readonly logger = new Logger(FavoriteNotificationConsumer.name);

    constructor(
        @InjectRepository(NotificationEntity)
        private readonly notificationRepo: Repository<NotificationEntity>,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedRepo: Repository<ProcessedEventEntity>,
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
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
            const doctor = await this.doctorRepo.findOne({ where: { id: msg.doctorId } });
            const name = msg.doctorName || doctor?.fullName || 'Doctor';

            await this.notificationRepo.save(
                this.notificationRepo.create({
                    userId: msg.userId,
                    doctorId: msg.doctorId,
                    type: 'FAVORITE_ADDED',
                    title: 'Added to favorites',
                    message: `Dr. ${name} has been added to favorite`,
                }),
            );
        } catch (err: any) {
            this.logger.error(`Favorite notification failed for ${msg.userId}/${msg.doctorId}: ${err.message}`);
        }
    }
}
