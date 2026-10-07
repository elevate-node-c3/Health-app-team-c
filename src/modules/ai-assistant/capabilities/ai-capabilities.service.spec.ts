import { Test, TestingModule } from '@nestjs/testing';
import { AiCapabilitiesService } from './ai-capabilities.service';
import {
    CATALOG_GATEWAY,
    CatalogGateway,
    FREE_SLOTS_PROVIDER,
    FreeSlotsProvider,
    SpecialtyInfo,
} from './catalog.gateway';
import { ToolSession } from './tool-session';
import { AI_POLICIES, AI_POLICY_TOPICS } from '../config/ai-policies.config';

describe('AiCapabilitiesService', () => {
    let service: AiCapabilitiesService;
    let catalog: jest.Mocked<CatalogGateway>;
    let freeSlotsProvider: jest.Mocked<FreeSlotsProvider>;

    const mockSpecialties: SpecialtyInfo[] = [
        { id: 'spec-1', name: 'Cardiology', aliases: ['Heart', 'قلب'], doctorCount: 5 },
        { id: 'spec-2', name: 'Dermatology', aliases: ['Skin', 'جلدية'], doctorCount: 3 },
    ];

    const createMockSession = (overrides?: Partial<ToolSession>): ToolSession =>
    ({
        userContext: { userId: 'user-123', deviceId: 'device-123' },
        isGuest: false,
        knownDoctors: new Map<string, string>(),
        specialtySuggestion: null,
        ...overrides,
    } as unknown as ToolSession);

    beforeEach(async () => {
        catalog = {
            listSpecialties: jest.fn(),
            searchDoctors: jest.fn(),
            getDoctor: jest.fn(),
            getDoctorClinics: jest.fn(),
            getAppointments: jest.fn(),
        } as unknown as jest.Mocked<CatalogGateway>;

        freeSlotsProvider = {
            getNextFreeSlots: jest.fn(),
        } as unknown as jest.Mocked<FreeSlotsProvider>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiCapabilitiesService,
                { provide: CATALOG_GATEWAY, useValue: catalog },
                { provide: FREE_SLOTS_PROVIDER, useValue: freeSlotsProvider },
            ],
        }).compile();

        service = module.get<AiCapabilitiesService>(AiCapabilitiesService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('listSpecialties', () => {
        it('should return list of specialties and total count', async () => {
            catalog.listSpecialties.mockResolvedValueOnce(mockSpecialties);

            const result = await service.listSpecialties();

            expect(result).toEqual({ specialties: mockSpecialties, total: 2 });
        });

        it('should return TEMPORARILY_UNAVAILABLE if catalog throws', async () => {
            catalog.listSpecialties.mockRejectedValueOnce(new Error('DB failure'));

            const result = await service.listSpecialties();

            expect(result).toEqual({ error: 'TEMPORARILY_UNAVAILABLE' });
        });
    });

    describe('suggestSpecialty', () => {
        it('should match exact specialty by name or alias and populate session', async () => {
            catalog.listSpecialties.mockResolvedValue(mockSpecialties);
            const session = createMockSession();

            const result = await service.suggestSpecialty({ specialty: 'Heart' }, session);

            expect(result).toEqual({ ok: true, specialtyId: 'spec-1', specialtyName: 'Cardiology' });
            expect(session.specialtySuggestion).toEqual({
                specialtyId: 'spec-1',
                specialtyName: 'Cardiology',
                nearMe: true,
                availableSoon: true,
            });
        });

        it('should match close specialty name if input length >= 4', async () => {
            catalog.listSpecialties.mockResolvedValue(mockSpecialties);
            const session = createMockSession();

            const result = await service.suggestSpecialty({ specialty: 'Cardio' }, session);

            expect(result).toEqual({ ok: true, specialtyId: 'spec-1', specialtyName: 'Cardiology' });
        });

        it('should return UNKNOWN_SPECIALTY when no match exists', async () => {
            catalog.listSpecialties.mockResolvedValue(mockSpecialties);
            const session = createMockSession();

            const result = await service.suggestSpecialty({ specialty: 'Neurology' }, session);

            expect(result).toEqual({
                ok: false,
                reason: 'UNKNOWN_SPECIALTY',
                availableSpecialties: ['Cardiology', 'Dermatology'],
            });
            expect(session.specialtySuggestion).toBeNull();
        });
    });

    describe('searchDoctors', () => {
        it('should return NEED_FILTER if neither specialty nor valid name is given', async () => {
            const session = createMockSession();

            const result = await service.searchDoctors({ name: '   ' }, session);

            expect(result).toEqual({ doctors: [], total: 0, reason: 'NEED_FILTER' });
            expect(catalog.searchDoctors).not.toHaveBeenCalled();
        });

        it('should return UNKNOWN_SPECIALTY if given specialty does not resolve', async () => {
            catalog.listSpecialties.mockResolvedValue(mockSpecialties);
            const session = createMockSession();

            const result = await service.searchDoctors({ specialty: 'UnknownSpec' }, session);

            expect(result).toMatchObject({
                doctors: [],
                total: 0,
                reason: 'UNKNOWN_SPECIALTY',
            });
        });

        it('should search doctors, update knownDoctors map in session, and return results', async () => {
            catalog.listSpecialties.mockResolvedValue(mockSpecialties);
            const mockDoctors = [{ id: 'doc-1', name: 'Dr. John Doe' }];
            catalog.searchDoctors.mockResolvedValueOnce({ doctors: mockDoctors as any, total: 1 });

            const session = createMockSession();
            const result = await service.searchDoctors({ specialty: 'Cardiology' }, session);

            expect(catalog.searchDoctors).toHaveBeenCalledWith({
                specialtyId: 'spec-1',
                name: undefined,
                limit: 5,
            });
            expect(session.knownDoctors.get('doc-1')).toBe('Dr. John Doe');
            expect(result).toEqual({ doctors: mockDoctors, total: 1, shown: 1 });
        });

        it('should return NO_MATCH with hint when search by name yields empty results', async () => {
            catalog.searchDoctors.mockResolvedValueOnce({ doctors: [], total: 0 });
            const session = createMockSession();

            const result = await service.searchDoctors({ name: 'Adam' }, session);

            expect(result).toMatchObject({
                doctors: [],
                total: 0,
                reason: 'NO_MATCH',
                hint: expect.any(String),
            });
        });
    });

    describe('getAvailability', () => {
        it('should return DOCTOR_NOT_FOUND when doctor does not exist', async () => {
            catalog.getDoctor.mockResolvedValueOnce(null);
            const session = createMockSession();

            const result = await service.getAvailability({ doctorId: 'doc-404' }, session);

            expect(result).toEqual({ found: false, reason: 'DOCTOR_NOT_FOUND' });
        });

        it('should return empty clinics note when doctor has no active clinics', async () => {
            const mockDoctor = { id: 'doc-1', name: 'Dr. Ahmed' };
            catalog.getDoctor.mockResolvedValueOnce(mockDoctor as any);
            catalog.getDoctorClinics.mockResolvedValueOnce([]);
            const session = createMockSession();

            const result = await service.getAvailability({ doctorId: 'doc-1' }, session);

            expect(session.knownDoctors.get('doc-1')).toBe('Dr. Ahmed');
            expect(result).toMatchObject({
                found: true,
                doctor: mockDoctor,
                clinics: [],
                freeSlots: null,
            });
        });

        it('should format free slots with weekday and return formatted schedule', async () => {
            const mockDoctor = { id: 'doc-1', name: 'Dr. Ahmed' };
            const mockClinics = [{ clinicId: 'clinic-1', clinicName: 'Downtown Clinic' }];
            const mockSlots = [{ clinicId: 'clinic-1', date: '2026-10-10', time: '14:00' }];

            catalog.getDoctor.mockResolvedValueOnce(mockDoctor as any);
            catalog.getDoctorClinics.mockResolvedValueOnce(mockClinics as any);
            freeSlotsProvider.getNextFreeSlots.mockResolvedValueOnce(mockSlots as any);

            const session = createMockSession();
            const result = (await service.getAvailability({ doctorId: 'doc-1' }, session)) as any;

            expect(result.found).toBe(true);
            expect(result.freeSlots).toHaveLength(1);
            expect(result.freeSlots[0]).toMatchObject({
                clinicId: 'clinic-1',
                clinicName: 'Downtown Clinic',
                date: '2026-10-10',
                time: '14:00',
                weekday: expect.any(String),
                weekdayAr: expect.any(String),
            });
        });

        it('should fallback gracefully when freeSlots lookup throws an error', async () => {
            const mockDoctor = { id: 'doc-1', name: 'Dr. Ahmed' };
            const mockClinics = [{ clinicId: 'clinic-1', clinicName: 'Downtown Clinic' }];

            catalog.getDoctor.mockResolvedValueOnce(mockDoctor as any);
            catalog.getDoctorClinics.mockResolvedValueOnce(mockClinics as any);
            freeSlotsProvider.getNextFreeSlots.mockRejectedValueOnce(new Error('Slot service offline'));

            const session = createMockSession();
            const result = (await service.getAvailability({ doctorId: 'doc-1' }, session)) as any;

            expect(result.found).toBe(true);
            expect(result.freeSlots).toBeNull();
            expect(result.note).toContain('Free time slots could not be checked right now');
        });
    });

    describe('getMyAppointments', () => {
        it('should return requiresAuth when user is guest or lacks userId', async () => {
            const guestSession = createMockSession({
                isGuest: true,
                userContext: { deviceId: 'dev-1' } as any,
            });

            const result = await service.getMyAppointments(guestSession);

            expect(result).toEqual({
                requiresAuth: true,
                message: 'The patient must sign in to see their appointments.',
            });
            expect(catalog.getAppointments).not.toHaveBeenCalled();
        });

        it('should return NO_APPOINTMENTS when user has zero appointments', async () => {
            catalog.getAppointments.mockResolvedValueOnce({ appointments: [], datesAvailable: true });
            const session = createMockSession();

            const result = await service.getMyAppointments(session);

            expect(result).toEqual({ appointments: [], reason: 'NO_APPOINTMENTS' });
        });

        it('should return appointments list with note if dates are not available', async () => {
            const mockAppts = [{ id: 'app-1', doctorName: 'Dr. John' }];
            catalog.getAppointments.mockResolvedValueOnce({
                appointments: mockAppts as any,
                datesAvailable: false,
            });

            const session = createMockSession();
            const result = await service.getMyAppointments(session);

            expect(result).toEqual({
                appointments: mockAppts,
                total: 1,
                note: 'Appointment dates are not available. Do not state or guess dates.',
            });
        });
    });

    describe('getPolicy', () => {
        it('should return UNKNOWN_TOPIC for invalid policy topic', () => {
            const result = service.getPolicy({ topic: 'INVALID_TOPIC' });

            expect(result).toEqual({
                found: false,
                reason: 'UNKNOWN_TOPIC',
                availableTopics: [...AI_POLICY_TOPICS],
            });
        });

        it('should return policy text for valid topic if available, or POLICY_NOT_AVAILABLE if empty', () => {
            const configuredTopic = AI_POLICY_TOPICS.find((t) => {
                const p = AI_POLICIES[t];
                return p && (p.ar || p.en);
            });

            if (configuredTopic) {
                const result = service.getPolicy({ topic: configuredTopic.toLowerCase() });
                expect(result).toMatchObject({
                    found: true,
                    topic: configuredTopic,
                    text: {
                        ar: AI_POLICIES[configuredTopic].ar,
                        en: AI_POLICIES[configuredTopic].en,
                    },
                });
            } else {
                const firstTopic = AI_POLICY_TOPICS[0];
                const result = service.getPolicy({ topic: firstTopic.toLowerCase() });
                expect(result).toEqual({
                    found: false,
                    reason: 'POLICY_NOT_AVAILABLE',
                });
            }
        });
    });
});