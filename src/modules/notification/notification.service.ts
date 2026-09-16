import { Injectable } from '@nestjs/common';
import { SendNotificationUseCase } from './use-case/send-notification.use-case';
import { GetUserNotificationsUseCase } from './use-case/get-user-notifications.use-case';
import { MarkAsReadUseCase } from './use-case/mark-as-read.use-case';
import { SendNotificationDto } from './dto/send-notification.dto';
import { MarkAllAsReadUseCase } from './use-case/mark-all-as-read.use-case';


@Injectable()
export class NotificationService {
    constructor(
        private readonly sendNotificationUseCase: SendNotificationUseCase,
        private readonly getUserNotificationsUseCase: GetUserNotificationsUseCase,
        private readonly markAsReadUseCase: MarkAsReadUseCase,
        private readonly markAllAsReadUseCase: MarkAllAsReadUseCase,
    ) { }

    async send(dto: SendNotificationDto) {
        return await this.sendNotificationUseCase.execute(dto);
    }

    async getUserNotifications(userId: string) {
        return await this.getUserNotificationsUseCase.execute(userId);
    }

    async markAsRead(notificationId: string, userId: string) {
        return await this.markAsReadUseCase.execute(notificationId, userId);
    }

    async markAllAsRead(userId: string) {
        return await this.markAllAsReadUseCase.execute(userId);
    }
}