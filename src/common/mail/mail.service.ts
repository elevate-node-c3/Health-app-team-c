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

    async sendPasswordResetEmail(email: string, otpCode: string): Promise<void> {
        try {
            const info = await this.transporter.sendMail({
                from: '"DOCURA Support" <noreply@docura.com>',
                to: email,
                subject: 'DOCURA - Reset Your Password',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Password reset requested</h2>
                        <p>Use the code below to reset your password:</p>
                        <h1 style="color: #2b6cb0; letter-spacing: 3px;">${otpCode}</h1>
                        <p>This code is valid for 3 minutes only.</p>
                    </div>
                `,
            });

            this.logger.debug(`Password reset email sent: ${info.messageId}`);
        } catch (error) {
            this.logger.error('Failed to send password reset email', error.stack);
            throw error;
        }
    }

    async sendPasswordChangedEmail(email: string, phoneNumber?: string): Promise<void> {
        const recipient = email || phoneNumber;
        if (!recipient) {
            return;
        }

        try {
            const info = await this.transporter.sendMail({
                from: '"DOCURA Support" <noreply@docura.com>',
                to: email,
                subject: 'DOCURA - Password Changed Successfully',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Password changed successfully</h2>
                        <p>Your password was updated successfully. All active sessions on your account were signed out for your protection.</p>
                    </div>
                `,
            });

            this.logger.debug(`Password changed notification sent: ${info.messageId}`);
        } catch (error) {
            this.logger.error('Failed to send password changed notification', error.stack);
            throw error;
        }
    }
}


