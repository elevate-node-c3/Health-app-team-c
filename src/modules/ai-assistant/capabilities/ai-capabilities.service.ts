import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    CATALOG_GATEWAY,
    CatalogGateway,
    FREE_SLOTS_PROVIDER,
    FreeSlotsProvider,
    SpecialtyInfo,
} from './catalog.gateway';
import { ToolSession } from './tool-session';
import { AI_POLICIES, AI_POLICY_TOPICS, AiPolicyTopic } from '../config/ai-policies.config';
import { normalizeText } from '../config/emergency-rules.config';
import { nameTokens } from './tool-args';
import { weekdayOf } from './working-hours';

const SEARCH_LIMIT = 5;
const APPOINTMENTS_LIMIT = 5;
const SLOTS_WINDOW_DAYS = 14;
const SLOTS_LIMIT = 6;

const UNAVAILABLE = { error: 'TEMPORARILY_UNAVAILABLE' } as const;

@Injectable()
export class AiCapabilitiesService {
    private readonly logger = new Logger(AiCapabilitiesService.name);

    constructor(
        @Inject(CATALOG_GATEWAY) private readonly catalog: CatalogGateway,
        @Optional() @Inject(FREE_SLOTS_PROVIDER) private readonly freeSlots?: FreeSlotsProvider,
    ) { }

    async listSpecialties() {
        return this.guard('list_specialties', async () => {
            const specialties = await this.catalog.listSpecialties();
            return { specialties, total: specialties.length };
        });
    }

    async suggestSpecialty(args: { specialty: string }, session: ToolSession) {
        return this.guard('suggest_specialty', async () => {
            const { match, available } = await this.resolveSpecialty(args.specialty);
            if (!match) {
                return {
                    ok: false,
                    reason: 'UNKNOWN_SPECIALTY',
                    availableSpecialties: available.map((s) => s.name),
                };
            }

            session.specialtySuggestion = {
                specialtyId: match.id,
                specialtyName: match.name,
                nearMe: true,
                availableSoon: true,
            };
            return { ok: true, specialtyId: match.id, specialtyName: match.name };
        });
    }

    async searchDoctors(args: { specialty?: string; name?: string }, session: ToolSession) {
        return this.guard('search_doctors', async () => {
            const hasName = nameTokens(args.name).length > 0;
            if (!args.specialty && !hasName) {
                return { doctors: [], total: 0, reason: 'NEED_FILTER' };
            }

            let specialtyId: string | undefined;
            if (args.specialty) {
                const { match, available } = await this.resolveSpecialty(args.specialty);
                if (!match) {
                    return {
                        doctors: [],
                        total: 0,
                        reason: 'UNKNOWN_SPECIALTY',
                        availableSpecialties: available.map((s) => s.name),
                    };
                }
                specialtyId = match.id;
            }

            const { doctors, total } = await this.catalog.searchDoctors({
                specialtyId,
                name: hasName ? args.name : undefined,
                limit: SEARCH_LIMIT,
            });

            doctors.forEach((d) => session.knownDoctors.set(d.id, d.name));

            if (!doctors.length) {
                return {
                    doctors: [],
                    total: 0,
                    reason: 'NO_MATCH',
                    ...(hasName
                        ? {
                            hint:
                                'Doctor names are stored exactly as shown to patients (often in English, with a number at the end). If you translated, transliterated or shortened the name, retry ONCE with the name exactly as the patient wrote it. If it still fails, say honestly that no such doctor was found and offer to search by specialty.',
                        }
                        : {}),
                };
            }
            return { doctors, total, shown: doctors.length };
        });
    }

    async getAvailability(args: { doctorId: string }, session: ToolSession) {
        return this.guard('get_availability', async () => {
            const doctor = await this.catalog.getDoctor(args.doctorId);
            if (!doctor) return { found: false, reason: 'DOCTOR_NOT_FOUND' };

            session.knownDoctors.set(doctor.id, doctor.name);
            const clinics = await this.catalog.getDoctorClinics(doctor.id);

            if (!clinics.length) {
                return {
                    found: true,
                    doctor,
                    clinics: [],
                    freeSlots: null,
                    note:
                        'This doctor has no active clinic available for booking right now. Say so honestly and offer to search other doctors in the same specialty.',
                };
            }

            if (!this.freeSlots) {
                return {
                    found: true,
                    doctor,
                    clinics,
                    freeSlots: null,
                    note:
                        'Exact free time slots are not available to the assistant. workingHours are the clinic weekly schedule, NOT free slots. Do not state or guess specific appointment times; tell the patient to open the doctor page to see free slots.',
                };
            }

            let slots: Awaited<ReturnType<FreeSlotsProvider['getNextFreeSlots']>>;
            try {
                slots = await this.freeSlots.getNextFreeSlots(doctor.id, {
                    days: SLOTS_WINDOW_DAYS,
                    limit: SLOTS_LIMIT,
                });
            } catch (error) {
                this.logger.error(`Free slots lookup failed: ${(error as Error)?.message}`);
                return {
                    found: true,
                    doctor,
                    clinics,
                    freeSlots: null,
                    note:
                        'Free time slots could not be checked right now. Do not state or guess specific appointment times; tell the patient to open the doctor page.',
                };
            }

            const clinicNames = new Map(clinics.map((c) => [c.clinicId, c.clinicName]));
            const freeSlots = slots.map((slot) => {
                const weekday = weekdayOf(slot.date);
                return {
                    clinicId: slot.clinicId,
                    clinicName: clinicNames.get(slot.clinicId) ?? null,
                    date: slot.date,
                    weekday: weekday.en,
                    weekdayAr: weekday.ar,
                    time: slot.time,
                };
            });

            return {
                found: true,
                doctor,
                clinics,
                freeSlots,
                note: freeSlots.length
                    ? 'freeSlots are the next real free times (clinic local time, Africa/Cairo, time HH:mm). Copy clinicName, weekday/weekdayAr, date and time EXACTLY as given; never translate or infer a weekday yourself. workingHours (day/dayAr) are the weekly schedule, NOT free slots. Only mention times listed in freeSlots.'
                    : `No free slots in the next ${SLOTS_WINDOW_DAYS} days. Say so honestly.`,
            };
        });
    }

    async getMyAppointments(session: ToolSession) {
        if (session.isGuest || !session.userContext.userId) {
            return { requiresAuth: true, message: 'The patient must sign in to see their appointments.' };
        }

        return this.guard('get_my_appointments', async () => {
            const { appointments, datesAvailable } = await this.catalog.getAppointments(
                session.userContext.userId as string,
                APPOINTMENTS_LIMIT,
            );

            if (!appointments.length) return { appointments: [], reason: 'NO_APPOINTMENTS' };

            return {
                appointments,
                total: appointments.length,
                ...(datesAvailable ? {} : { note: 'Appointment dates are not available. Do not state or guess dates.' }),
            };
        });
    }

    getPolicy(args: { topic: string }) {
        const topic = args.topic.toUpperCase() as AiPolicyTopic;
        if (!(AI_POLICY_TOPICS as readonly string[]).includes(topic)) {
            return { found: false, reason: 'UNKNOWN_TOPIC', availableTopics: [...AI_POLICY_TOPICS] };
        }

        const policy = AI_POLICIES[topic];
        if (!policy.ar && !policy.en) return { found: false, reason: 'POLICY_NOT_AVAILABLE' };
        return { found: true, topic, text: { ar: policy.ar, en: policy.en } };
    }


    private async resolveSpecialty(input: string): Promise<{ match: SpecialtyInfo | null; available: SpecialtyInfo[] }> {
        const available = await this.catalog.listSpecialties();
        const q = normalizeText(input);

        const namesOf = (s: SpecialtyInfo) => [s.name, ...s.aliases].map((n) => normalizeText(n)).filter(Boolean);

        const exact = available.find((s) => namesOf(s).includes(q));
        if (exact) return { match: exact, available };

        if (q.length >= 4) {
            const close = available.filter((s) => namesOf(s).some((n) => n.startsWith(q) || q.startsWith(n)));
            if (close.length === 1) return { match: close[0], available };
        }
        return { match: null, available };
    }

    private async guard<T>(tool: string, fn: () => Promise<T>): Promise<T | typeof UNAVAILABLE> {
        try {
            return await fn();
        } catch (error) {
            this.logger.error(`Capability ${tool} failed: ${(error as Error)?.message}`);
            return UNAVAILABLE;
        }
    }
}