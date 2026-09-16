import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../entities/notification.entity';

@Injectable()
export class MarkAllAsReadUseCase {
    private readonly logger = new Logger(MarkAllAsReadUseCase.name);

    constructor(
        @InjectRepository(NotificationEntity)
        private readonly notificationRepo: Repository<NotificationEntity>,
    ) { }

    async execute(userId: string): Promise<{ updatedCount: number }> {
        const result = await this.notificationRepo.update(
            { userId, isRead: false },
            { isRead: true },
        );

        this.logger.log(`Marked all notifications as read for user: ${userId}`);

        return { updatedCount: result.affected || 0 };
    }
}