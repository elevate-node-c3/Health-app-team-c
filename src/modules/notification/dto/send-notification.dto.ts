import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class SendNotificationDto {
    @IsUUID()
    @IsNotEmpty()
    userId: string;

    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    message: string;
}