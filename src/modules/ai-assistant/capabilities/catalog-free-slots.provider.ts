import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CATALOG_GATEWAY, CatalogGateway, FreeSlotsProvider } from './catalog.gateway';
import { GetDoctorAvailabilityUseCase } from 'src/modules/catalog/use-case/get-doctor-availability.use-case';

const CLINIC_TIME_ZONE = 'Africa/Cairo';
const MAX_PER_CLINIC_DAY = 3;


@Injectable()
export class CatalogFreeSlotsProvider implements FreeSlotsProvider {
    constructor(
        @Inject(CATALOG_GATEWAY) private readonly catalog: CatalogGateway,
        private readonly availability: GetDoctorAvailabilityUseCase,
    ) { }

    async getNextFreeSlots(doctorId: string, options: { days: number; limit: number }) {
        const clinics = await this.catalog.getDoctorClinics(doctorId);
        const result: Array<{ clinicId: string; date: string; time: string }> = [];
        const today = this.todayInClinicZone();
        let succeededCalls = 0;

        for (let i = 0; i < options.days && result.length < options.limit; i++) {
            const date = this.addDays(today, i);

            for (const clinic of clinics) {
                if (result.length >= options.limit) break;

                let data;
                try {
                    ({ data } = await this.availability.execute({ doctorId, clinicId: clinic.clinicId, date }));
                    succeededCalls++;
                } catch (error) {
                    if (error instanceof NotFoundException || error instanceof BadRequestException) continue;
                    throw error;
                }

                const daySlots = [...data.slots.Morning, ...data.slots.Afternoon, ...data.slots.Night]
                    .filter((s) => s.status === 'AVAILABLE')
                    .slice(0, MAX_PER_CLINIC_DAY);

                for (const slot of daySlots) {
                    if (result.length >= options.limit) break;
                    result.push({ clinicId: clinic.clinicId, date, time: slot.time });
                }
            }
        }


        if (clinics.length > 0 && succeededCalls === 0) {
            throw new Error('NO_CLINIC_AVAILABLE_FOR_BOOKING');
        }

        return result.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    }

    private todayInClinicZone(): string {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: CLINIC_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    }

    private addDays(date: string, days: number): string {
        const [y, m, d] = date.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
    }
}