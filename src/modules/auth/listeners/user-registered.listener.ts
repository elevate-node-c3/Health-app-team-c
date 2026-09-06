import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailService } from 'src/common/mail/mail.service';

@Injectable()
export class UserRegisteredListener {
    constructor(private readonly mailService: MailService) { }

    @OnEvent('user.registered')
    async handleUserRegisteredEvent(payload: { userId: string; email: string; otpCode: string }) {
        const { email, otpCode } = payload;
        await this.mailService.sendVerificationEmail(email, otpCode);
    }
}