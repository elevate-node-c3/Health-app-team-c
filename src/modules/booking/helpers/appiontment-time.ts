import { DateTime } from 'luxon';

export const CLINIC_TZ = 'Africa/Cairo';

export function toInstant(date: string, time: string): Date {
    const dt = DateTime.fromISO(`${date}T${time}`, { zone: CLINIC_TZ });
    if (!dt.isValid) {
        throw new Error(`Invalid appointment time: ${date} ${time}`);
    }
    return dt.toJSDate();
}

export function getAppointmentStart(appointment: { date: string; startTime: string }): Date {
    return toInstant(appointment.date, appointment.startTime);
}