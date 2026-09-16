import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    HttpCode,
    HttpStatus,
    UseGuards,
    Req
} from '@nestjs/common';
import { SendNotificationUseCase } from './use-case/send-notification.use-case';
import { GetUserNotificationsUseCase } from './use-case/get-user-notifications.use-case';
import { MarkAsReadUseCase } from './use-case/mark-as-read.use-case';
import { SendNotificationDto } from './dto/send-notification.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserStatus } from '../auth/entities/user.entity';
import { MarkAllAsReadUseCase } from './use-case/mark-all-as-read.use-case';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
    constructor(
        private readonly notificationService: NotificationService,
    ) { }

    @Post()
    @UseGuards(RolesGuard)
    @Roles(UserStatus.ADMIN)
    @HttpCode(HttpStatus.CREATED)
    async sendNotification(@Body() dto: SendNotificationDto) {
        return await this.notificationService.send(dto);
    }

    @Get('user')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.ADMIN, UserStatus.DOCTOR, UserStatus.PATIENT)
    async getUserNotifications(@Req() req) {
        const userId = req.userContext!.userId;
        return await this.notificationService.getUserNotifications(userId);
    }

    @Patch(':id/read')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.ADMIN, UserStatus.DOCTOR, UserStatus.PATIENT)
    async markAsRead(
        @Param('id') id: string,
        @Req() req,
    ) {
        const userId = req.userContext!.userId;
        return await this.notificationService.markAsRead(id, userId);
    }

    @Patch('user/read-all')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.ADMIN, UserStatus.DOCTOR, UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    async markAllAsRead(@Req() req) {
        const userId = req.userContext!.userId;
        const result = await this.notificationService.markAllAsRead(userId);
        return {
            success: true,
            message: 'All notifications marked as read',
            data: result,
        };
    }
}