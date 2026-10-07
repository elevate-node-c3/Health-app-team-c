import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogFreeSlotsProvider } from './catalog-free-slots.provider';
import { CATALOG_GATEWAY, CatalogGateway } from './catalog.gateway';
import { GetDoctorAvailabilityUseCase } from 'src/modules/catalog/use-case/get-doctor-availability.use-case';

describe('CatalogFreeSlotsProvider', () => {
    let provider: CatalogFreeSlotsProvider;
    let catalog: jest.Mocked<CatalogGateway>;
    let availability: jest.Mocked<GetDoctorAvailabilityUseCase>;

    const mockClinics = [
        {
            clinicId: 'clinic-1',
            clinicName: 'Downtown Clinic',
            consultationFee: 300,
            workingHours: [],
        },
        {
            clinicId: 'clinic-2',
            clinicName: 'Zamalek Clinic',
            consultationFee: 400,
            workingHours: [],
        },
    ] as any;

    beforeEach(async () => {
        catalog = {
            getDoctorClinics: jest.fn(),
        } as unknown as jest.Mocked<CatalogGateway>;

        availability = {
            execute: jest.fn(),
        } as unknown as jest.Mocked<GetDoctorAvailabilityUseCase>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CatalogFreeSlotsProvider,
                { provide: CATALOG_GATEWAY, useValue: catalog },
                { provide: GetDoctorAvailabilityUseCase, useValue: availability },
            ],
        }).compile();

        provider = module.get<CatalogFreeSlotsProvider>(CatalogFreeSlotsProvider);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getNextFreeSlots', () => {
        it('should return an empty array if doctor has no clinics without throwing', async () => {
            catalog.getDoctorClinics.mockResolvedValueOnce([]);

            const result = await provider.getNextFreeSlots('doc-1', { days: 7, limit: 5 });

            expect(result).toEqual([]);
            expect(availability.execute).not.toHaveBeenCalled();
        });

        it('should collect, filter AVAILABLE slots, enforce MAX_PER_CLINIC_DAY (3), and sort them chronologically', async () => {
            catalog.getDoctorClinics.mockResolvedValueOnce([mockClinics[0]]);

            availability.execute.mockResolvedValue({
                data: {
                    slots: {
                        Morning: [
                            { time: '11:00', status: 'AVAILABLE' },
                            { time: '09:00', status: 'AVAILABLE' },
                            { time: '10:00', status: 'BOOKED' },
                        ],
                        Afternoon: [
                            { time: '13:00', status: 'AVAILABLE' },
                            { time: '14:00', status: 'AVAILABLE' },
                        ],
                        Night: [],
                    },
                },
            } as any);

            const result = await provider.getNextFreeSlots('doc-1', { days: 1, limit: 10 });

            expect(result).toHaveLength(3);
            expect(result.map((s) => s.time)).toEqual(['09:00', '11:00', '13:00']);
            expect(result[0].clinicId).toBe('clinic-1');
        });

        it('should respect overall limit across multiple days and clinics', async () => {
            catalog.getDoctorClinics.mockResolvedValueOnce(mockClinics);

            availability.execute.mockResolvedValue({
                data: {
                    slots: {
                        Morning: [{ time: '10:00', status: 'AVAILABLE' }],
                        Afternoon: [{ time: '14:00', status: 'AVAILABLE' }],
                        Night: [],
                    },
                },
            } as any);

            // نطلب 3 مواعيد فقط
            const result = await provider.getNextFreeSlots('doc-1', { days: 5, limit: 3 });

            expect(result).toHaveLength(3);
        });

        it('should skip clinics that throw NotFoundException or BadRequestException and keep successful ones', async () => {
            catalog.getDoctorClinics.mockResolvedValueOnce(mockClinics);

            availability.execute
                .mockRejectedValueOnce(new NotFoundException('Doctor not found in clinic'))
                .mockResolvedValueOnce({
                    data: {
                        slots: {
                            Morning: [{ time: '10:00', status: 'AVAILABLE' }],
                            Afternoon: [],
                            Night: [],
                        },
                    },
                } as any);

            const result = await provider.getNextFreeSlots('doc-1', { days: 1, limit: 5 });

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                clinicId: 'clinic-2',
                time: '10:00',
            });
        });

        it('should throw NO_CLINIC_AVAILABLE_FOR_BOOKING when clinics exist but all calls fail with 404/400', async () => {
            catalog.getDoctorClinics.mockResolvedValueOnce([mockClinics[0]]);

            availability.execute.mockRejectedValue(
                new BadRequestException('Clinic temporarily not taking bookings'),
            );

            await expect(
                provider.getNextFreeSlots('doc-1', { days: 2, limit: 5 }),
            ).rejects.toThrow('NO_CLINIC_AVAILABLE_FOR_BOOKING');
        });

        it('should rethrow unexpected errors directly (e.g. Database connection crash)', async () => {
            catalog.getDoctorClinics.mockResolvedValueOnce([mockClinics[0]]);

            availability.execute.mockRejectedValueOnce(new Error('PostgreSQL timeout'));

            await expect(
                provider.getNextFreeSlots('doc-1', { days: 1, limit: 5 }),
            ).rejects.toThrow('PostgreSQL timeout');
        });
    });
});