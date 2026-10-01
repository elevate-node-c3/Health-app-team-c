import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface RefundEmailDetails {
    amount: number;
    expectedArrivalAt: Date | string;
    providerRefundId: string;
    appointmentId: string;
}

@Injectable()
export class RefundMailService {
    private readonly logger = new Logger(RefundMailService.name);
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

    async sendRefundConfirmationEmail(
        email: string,
        details: RefundEmailDetails,
    ): Promise<void> {
        const formattedAmount = `EGP ${details.amount}`;
        const providerRefundId = this.escapeHtml(details.providerRefundId);
        const appointmentId = this.escapeHtml(details.appointmentId);
        const expectedArrivalDate = this.formatDate(details.expectedArrivalAt);

        const rows: Array<[string, string]> = [
            ['Refund Amount', formattedAmount],
            ['Expected Arrival', expectedArrivalDate],
            ['Refund ID', providerRefundId],
            ['Appointment ID', appointmentId],
        ];

        const rowsHtml = rows
            .map(
                ([label, value]) => `
                    <tr>
                        <td style="padding: 10px 0; color: #718096; font-size: 14px; width: 140px; border-bottom: 1px solid #edf2f7;">${label}</td>
                        <td style="padding: 10px 0; color: #1a202c; font-size: 15px; font-weight: 600; border-bottom: 1px solid #edf2f7;">${value}</td>
                    </tr>`,
            )
            .join('');

        const html = `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f6f8; padding: 24px 12px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                    <tr>
                        <td style="background-color: #2b6cb0; padding: 24px; text-align: center;">
                            <div style="color: #ffffff; font-size: 13px; letter-spacing: 2px;">DOCURA</div>
                            <div style="color: #ffffff; font-size: 22px; font-weight: bold; margin-top: 8px;">Refund Issued</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px;">
                            <p style="margin: 0 0 16px; color: #2d3748; font-size: 15px; line-height: 1.5;">
                                Your refund request for the cancelled appointment has been processed and sent to your bank.
                            </p>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 8px 0 20px;">
                                ${rowsHtml}
                            </table>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="background-color: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px 14px; color: #9c4221; font-size: 14px; line-height: 1.5;">
                                        <strong>Please note:</strong> It may take <strong>5 to 10 business days</strong> for the funds to reflect in your bank account, depending on your bank's processing timelines.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 16px 24px 24px; text-align: center; color: #a0aec0; font-size: 12px; line-height: 1.5;">
                            Thank you for choosing DOCURA.<br />
                            This is an automated message, please do not reply.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

        const text = [
            'Your refund request has been processed.',
            '',
            ...rows.map(([label, value]) => `${label}: ${this.unescapeForText(value)}`),
            '',
            'Please note: It may take 5 to 10 business days for the funds to reflect in your account.',
            '',
            'Thank you for choosing DOCURA.',
        ].join('\n');

        try {
            const info = await this.transporter.sendMail({
                from: '"DOCURA Billing" <billing@docura.com>',
                to: email,
                subject: 'DOCURA - Refund Issued',
                html,
                text,
            });

            this.logger.debug(`Refund confirmation email sent to ${email}: ${info.messageId}`);
        } catch (error: any) {
            this.logger.error(`Failed to send refund email to ${email}`, error.stack);
            throw error;
        }
    }

    private formatDate(dateInput?: Date | string): string {
        if (!dateInput) return '';
        const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        if (isNaN(d.getTime())) return this.escapeHtml(String(dateInput));

        return d.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
        });
    }

    private escapeHtml(value?: string): string {
        if (!value) return '';
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private unescapeForText(value: string): string {
        return value
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&amp;/g, '&');
    }
}