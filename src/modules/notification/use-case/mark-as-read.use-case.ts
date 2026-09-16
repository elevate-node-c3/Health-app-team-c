import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../entities/notification.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class MarkAsReadUseCase {
    constructor(
        @InjectRepository(NotificationEntity)
        private readonly notificationRepository: Repository<NotificationEntity>,
    ) { }

    async execute(notificationId: string, userId: string): Promise<NotificationEntity> {
        const notification = await this.notificationRepository.findOne({
            where: { id: notificationId, userId },
        });

        if (!notification) {
            throw new NotFoundException('Notification not found');
        }

        notification.isRead = true;

        try {
            return await this.notificationRepository.save(notification);
        } catch (error) {
            throw new InternalServerErrorException('Failed to update notification');
        }
    }
}