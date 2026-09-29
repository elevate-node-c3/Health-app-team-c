import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { SendNotificationUseCase } from './use-case/send-notification.use-case';
import { GetUserNotificationsUseCase } from './use-case/get-user-notifications.use-case';
import { MarkAsReadUseCase } from './use-case/mark-as-read.use-case';
import { NotificationEntity } from './entities/notification.entity';
import { FavoriteNotificationConsumer } from './consumers/favorite-notification.consumer';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { MarkAllAsReadUseCase } from './use-case/mark-all-as-read.use-case';
import { AppointmentEventsConsumer } from './consumers/appointment-notification.consumer';
import { UserEntity } from '../auth/entities/user.entity';
import { AppointmentMailService } from 'src/common/mail/appointment-mail.service';

const USE_CASES = [
    SendNotificationUseCase,
    GetUserNotificationsUseCase,
    MarkAsReadUseCase,
    MarkAllAsReadUseCase,
];

@Module({
    imports: [TypeOrmModule.forFeature([
        NotificationEntity,
        ProcessedEventEntity,
        UserEntity,
    ])],
    controllers: [NotificationController],
    providers: [
        NotificationService,
        FavoriteNotificationConsumer,
        AppointmentEventsConsumer,
        AppointmentMailService,
        ...USE_CASES
    ],
    exports: [
        NotificationService,
        ...USE_CASES
    ],
})
export class NotificationModule { }