import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength, Matches } from 'class-validator';

export class SendMessageDto {
    @IsOptional()
    @IsUUID()
    conversationId?: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/\S/, { message: 'Message must not be blank' })
    @MaxLength(2000, { message: 'Message too long, Maximum 2000 characters' })
    message: string;

    @IsOptional()
    @IsUUID()
    clientMessageId?: string;

    @IsOptional()
    @IsString()
    deviceId?: string;
}