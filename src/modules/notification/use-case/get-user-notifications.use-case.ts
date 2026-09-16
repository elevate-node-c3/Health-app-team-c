import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../entities/notification.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class GetUserNotificationsUseCase {
    private readonly logger = new Logger(GetUserNotificationsUseCase.name);

    constructor(
        @InjectRepository(NotificationEntity)
        private readonly notificationRepository: Repository<NotificationEntity>,
    ) { }

    async execute(userId: string): Promise<NotificationEntity[]> {
        try {
            return await this.notificationRepository.find({
                where: { userId },
                order: { createdAt: 'DESC' },
            });
        } catch (error) {
            this.logger.error(`Failed to fetch notifications for user: ${userId}`, error.stack);
            throw new InternalServerErrorException('Failed to fetch notifications');
        }
    }
}