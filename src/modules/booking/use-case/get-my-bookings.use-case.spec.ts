import { Test, TestingModule } from '@nestjs/testing';
import { GetMyBookingsUseCase } from './get-my-bookings.use-case';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppointmentEntity, AppointmentStatus } from '../../catalog/entities/appointment.entity';
import { PrescriptionEntity } from '../../prescription/entities/prescription.entity';

describe('GetMyBookingsUseCase', () => {
    let useCase: GetMyBookingsUseCase;
    let appointmentRepo: any;
    let prescriptionRepo: any;

    beforeEach(async () => {
        appointmentRepo = {
            createQueryBuilder: jest.fn().mockReturnValue({
                leftJoinAndSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                addOrderBy: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                take: jest.fn().mockReturnThis(),
                getManyAndCount: jest.fn().mockResolvedValue([
                    [
                        {
                            id: 'app-1',
                            patientId: 'user-1',
                            status: AppointmentStatus.BOOKED,
                            date: '2099-01-01',
                            startTime: '10:00',
                            doctor: { fullName: 'Dr. John', photoUrl: 'url', isActive: true },
                            clinic: { name: 'Clinic A', city: 'City', governorate: 'Gov', isActive: true },
                            snapshotSpecialtyName: 'Cardio',
                        },
                        {
                            id: 'app-2',
                            patientId: 'user-1',
                            status: AppointmentStatus.COMPLETED,
                            date: '2020-01-01',
                            startTime: '10:00',
                            doctor: { fullName: 'Dr. John', photoUrl: 'url', isActive: true },
                            clinic: { name: 'Clinic A', city: 'City', governorate: 'Gov', isActive: true },
                            snapshotSpecialtyName: 'Cardio',
                        },
                        {
                            id: 'app-3',
                            patientId: 'user-1',
                            status: AppointmentStatus.CANCELLED,
                            date: '2020-01-01',
                            startTime: '10:00',
                            doctor: { fullName: 'Dr. John', photoUrl: 'url', isActive: false }, // Inactive doctor
                            clinic: { name: 'Clinic A', city: 'City', governorate: 'Gov', isActive: true },
                            snapshotSpecialtyName: 'Cardio',
                        },
                    ],
                    3
                ])
            })
        };

        prescriptionRepo = {
            find: jest.fn().mockResolvedValue([{ id: 'rx-1', appointmentId: 'app-2' }])
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetMyBookingsUseCase,
                {
                    provide: getRepositoryToken(AppointmentEntity),
                    useValue: appointmentRepo,
                },
                {
                    provide: getRepositoryToken(PrescriptionEntity),
                    useValue: prescriptionRepo,
                },
            ],
        }).compile();

        useCase = module.get<GetMyBookingsUseCase>(GetMyBookingsUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should return mapped booking cards with correct actions', async () => {
        const result = await useCase.execute('user-1', { tab: 'ALL' });
        
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(3);
        
        // Upcoming app-1
        expect(result.data[0].actions).toContain('CANCEL');
        expect(result.data[0].actions).toContain('RESCHEDULE');
        
        // Completed app-2 (has prescription)
        expect(result.data[1].actions).toContain('DOWNLOAD_PRESCRIPTION');
        
        // Cancelled app-3 (inactive doctor -> no REBOOK)
        expect(result.data[2].actions).not.toContain('REBOOK');
    });

    it('should allow REBOOK if cancelled and doctor/clinic are active', async () => {
        appointmentRepo.createQueryBuilder().getManyAndCount.mockResolvedValueOnce([
            [{
                id: 'app-4',
                status: AppointmentStatus.CANCELLED,
                date: '2020-01-01',
                startTime: '10:00',
                doctor: { isActive: true }, // Active
                clinic: { isActive: true }, // Active
            }],
            1
        ]);
        
        const result = await useCase.execute('user-1', { tab: 'CANCELLED' });
        expect(result.data[0].actions).toContain('REBOOK');
    });
});
