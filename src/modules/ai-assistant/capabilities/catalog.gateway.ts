

import { WorkingDay } from './working-hours';

export interface DoctorSummary {
    id: string;
    name: string;
    specialty: string | null;
}

export interface SpecialtyInfo {
    id: string;
    name: string;
    aliases: string[];
    doctorCount: number;
}

export interface DoctorClinicInfo {
    clinicId: string;
    clinicName: string | null;
    consultationFee: number | string | null;
    workingHours: WorkingDay[];
}

export interface AppointmentSummary {
    doctorName: string | null;
    specialty: string | null;
    clinicName: string | null;
    status: string;
    startsAt: string | null;
}

export interface CatalogGateway {
    listSpecialties(): Promise<SpecialtyInfo[]>;

    searchDoctors(query: {
        specialtyId?: string;
        name?: string;
        limit: number;
    }): Promise<{ doctors: DoctorSummary[]; total: number }>;

    getDoctor(doctorId: string): Promise<DoctorSummary | null>;

    getDoctorClinics(doctorId: string): Promise<DoctorClinicInfo[]>;

    getAppointments(
        patientId: string,
        limit: number,
    ): Promise<{ appointments: AppointmentSummary[]; datesAvailable: boolean }>;
}


export interface FreeSlotsProvider {
    getNextFreeSlots(
        doctorId: string,
        options: { days: number; limit: number },
    ): Promise<Array<{ clinicId: string; date: string; time: string }>>;
}

export const CATALOG_GATEWAY = Symbol('CATALOG_GATEWAY');
export const FREE_SLOTS_PROVIDER = Symbol('FREE_SLOTS_PROVIDER');