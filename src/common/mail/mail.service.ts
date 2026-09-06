import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST || 'sandbox.smtp.mailtrap.io',
            port: Number(process.env.MAIL_PORT) || 2525,
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASS,
            },
        });
    }

    async sendVerificationEmail(email: string, otpCode: string): Promise<void> {
        try {
            const info = await this.transporter.sendMail({
                from: '"DOCURA Support" <noreply@docura.com>',
                to: email,
                subject: 'DOCURA - Verify Your Account',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Welcome to DOCURA!</h2>
                        <p>Please use the verification code below to complete your registration:</p>
                        <h1 style="color: #2b6cb0; letter-spacing: 3px;">${otpCode}</h1>
                        <p>This code is valid for 3 minutes only.</p>
                    </div>
                `,
            });

            this.logger.debug(`Verification email sent: ${info.messageId}`);
        } catch (error) {
            this.logger.error('Failed to send verification email', error.stack);
            throw error;
        }
    }
}