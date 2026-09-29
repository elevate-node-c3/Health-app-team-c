import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface AppointmentEmailDetails {
    doctorName?: string;
    slotDate?: string;
    slotTime?: string;
    doctorId: string;
    slotId: string;
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
        try {
            const info = await this.transporter.sendMail({
                from: '"DOCURA Appointments" <appointments@docura.com>',
                to: email,
                subject: 'DOCURA - Appointment Booking Confirmed!',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #2b6cb0;">Appointment Confirmed!</h2>
                        <p>Your payment was successful and your appointment is locked in.</p>
                        <hr style="border: 0; border-top: 1px solid #eee;" />
                        
                        <table style="width: 100%; text-align: left; margin: 15px 0;">
                            <tr>
                                <td><strong>Doctor ID:</strong></td>
                                <td>${details.doctorId}</td>
                            </tr>
                            <tr>
                                <td><strong>Slot ID:</strong></td>
                                <td>${details.slotId}</td>
                            </tr>
                            ${details.slotDate ? `<tr><td><strong>Date:</strong></td><td>${details.slotDate}</td></tr>` : ''}
                            ${details.slotTime ? `<tr><td><strong>Time:</strong></td><td>${details.slotTime}</td></tr>` : ''}
                        </table>

                        <div style="background-color: #f7fafc; padding: 12px; border-left: 4px solid #2b6cb0; margin: 15px 0;">
                            <strong>Instructions:</strong> ${details.instructions}
                        </div>

                        <hr style="border: 0; border-top: 1px solid #eee;" />
                        <p style="color: #718096; font-size: 12px;">Thank you for choosing DOCURA.</p>
                    </div>
                `,
            });

            this.logger.debug(`Appointment confirmation email sent to ${email}: ${info.messageId}`);
        } catch (error) {
            this.logger.error(`Failed to send appointment email to ${email}`, error.stack);
            throw error;
        }
    }
}