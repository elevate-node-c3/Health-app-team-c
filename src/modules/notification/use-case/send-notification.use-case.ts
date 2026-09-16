import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../entities/notification.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { SendNotificationDto } from '../dto/send-notification.dto';

@Injectable()
export class SendNotificationUseCase {
    private readonly logger = new Logger(SendNotificationUseCase.name);

    constructor(
        @InjectRepository(NotificationEntity)
        private readonly notificationRepository: Repository<NotificationEntity>,
    ) { }

    async execute(dto: SendNotificationDto): Promise<NotificationEntity> {
        try {
            const notification = this.notificationRepository.create({
                userId: dto.userId,
                title: dto.title,
                message: dto.message,
                isRead: false,
            });

            const savedNotification = await this.notificationRepository.save(notification);

            this.logger.log(`Notification sent successfully to user: ${dto.userId}`);
            return savedNotification;
        } catch (error) {
            this.logger.error(`Failed to send notification to user: ${dto.userId}`, error.stack);
            throw new InternalServerErrorException('Failed to send notification');
        }
    }
}