import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { MailService } from 'src/common/mail/mail.service';

@Injectable()
export class AuthRabbitMQConsumer {
    private readonly logger = new Logger(AuthRabbitMQConsumer.name);

    constructor(private readonly mailService: MailService) { }

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'user.registered',
        queue: 'user_registration_queue',
    })
    public async handleUserRegistered(msg: { userId: string; email: string; otpCode: string }) {
        this.logger.log(`[RabbitMQ Consumer] Received 'user.registered' event for email: ${msg.email}`);

        try {
            await this.mailService.sendVerificationEmail(msg.email, msg.otpCode);

            this.logger.log(`[Email Dispatched Successfully] Verification email sent to ${msg.email}`);
        } catch (error) {
            this.logger.error(`Failed to send verification email to ${msg.email}: ${error.message}`);
        }
    }
}