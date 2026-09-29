export class DoctorProfileViewedEvent {
    doctorId: string;
    userId?: string;
    deviceId?: string;
    timestamp: Date;
    clientIp?: string;

    constructor(partial: Partial<DoctorProfileViewedEvent>) {
        Object.assign(this, partial);
    }
}
