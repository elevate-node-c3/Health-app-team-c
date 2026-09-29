import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface AppointmentEmailDetails {
    doctorName?: string;
    clinicName?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    instructions: string;
}

@Injectable()
export class AppointmentMailService {
    private readonly logger = new Logger(AppointmentMailService.name);
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

    async sendBookingConfirmation(email: string, details: AppointmentEmailDetails): Promise<void> {
        const doctor = this.escapeHtml(details.doctorName);
        const clinic = this.escapeHtml(details.clinicName);
        const instructions = this.escapeHtml(details.instructions);
        const prettyDate = this.formatDate(details.date);
        const start = this.formatTime(details.startTime);
        const end = this.formatTime(details.endTime);
        const timeRange = start && end ? `${start} – ${end}` : start || '';

        const rows: Array<[string, string]> = [];
        if (doctor) rows.push(['Doctor', doctor]);
        if (clinic) rows.push(['Clinic', clinic]);
        if (prettyDate) rows.push(['Date', prettyDate]);
        if (timeRange) rows.push(['Time', timeRange]);

        const rowsHtml = rows
            .map(
                ([label, value]) => `
                    <tr>
                        <td style="padding: 10px 0; color: #718096; font-size: 14px; width: 110px; border-bottom: 1px solid #edf2f7;">${label}</td>
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
                            <div style="color: #ffffff; font-size: 22px; font-weight: bold; margin-top: 8px;">Appointment Confirmed</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px;">
                            <p style="margin: 0 0 16px; color: #2d3748; font-size: 15px; line-height: 1.5;">
                                Your payment was successful and your appointment is booked. Here are the details:
                            </p>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 8px 0 20px;">
                                ${rowsHtml}
                            </table>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="background-color: #ebf8ff; border-left: 4px solid #2b6cb0; padding: 12px 14px; color: #2c5282; font-size: 14px; line-height: 1.5;">
                                        <strong>Please note:</strong> ${instructions}
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
            'Your appointment is confirmed.',
            '',
            ...rows.map(([label, value]) => `${label}: ${this.unescapeForText(value)}`),
            '',
            `Please note: ${details.instructions}`,
            '',
            'Thank you for choosing DOCURA.',
        ].join('\n');

        try {
            const info = await this.transporter.sendMail({
                from: '"DOCURA Appointments" <appointments@docura.com>',
                to: email,
                subject: prettyDate
                    ? `Appointment confirmed - ${prettyDate}`
                    : 'DOCURA - Appointment Booking Confirmed',
                html,
                text,
            });

            this.logger.debug(`Appointment confirmation email sent to ${email}: ${info.messageId}`);
        } catch (error) {
            this.logger.error(`Failed to send appointment email to ${email}`, error.stack);
            throw error;
        }
    }

    private formatDate(date?: string): string {
        if (!date) return '';
        const [y, m, d] = date.split('-').map(Number);
        if (!y || !m || !d) return this.escapeHtml(date);
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
        });
    }

    private formatTime(time?: string): string {
        if (!time) return '';
        const [hh, mm] = time.split(':').map(Number);
        if (Number.isNaN(hh) || Number.isNaN(mm)) return this.escapeHtml(time);
        const period = hh >= 12 ? 'PM' : 'AM';
        const hour12 = hh % 12 === 0 ? 12 : hh % 12;
        return `${hour12}:${String(mm).padStart(2, '0')} ${period}`;
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