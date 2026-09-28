import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GetDoctorProfileUseCase } from './get-doctor-profile.use-case';
import { DoctorEntity } from '../entities/doctor.entity';
import { ReviewEntity } from '../entities/review.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

describe('GetDoctorProfileUseCase', () => {
    let useCase: GetDoctorProfileUseCase;
    let doctorRepoMock: any;
    let reviewRepoMock: any;
    let outboxRepoMock: any;
    let outboxProcessorMock: any;

    beforeEach(async () => {
        doctorRepoMock = {
            findOne: jest.fn(),
        };
        reviewRepoMock = {
            find: jest.fn(),
        };
        outboxRepoMock = {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn().mockResolvedValue({ id: 'event-1' }),
        };
        outboxProcessorMock = {
            triggerPublish: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetDoctorProfileUseCase,
                { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepoMock },
                { provide: getRepositoryToken(ReviewEntity), useValue: reviewRepoMock },
                { provide: getRepositoryToken(OutboxEventEntity), useValue: outboxRepoMock },
                { provide: OutboxProcessorService, useValue: outboxProcessorMock },
            ],
        }).compile();

        useCase = module.get<GetDoctorProfileUseCase>(GetDoctorProfileUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw NotFoundException if doctor not found or inactive', async () => {
        doctorRepoMock.findOne.mockResolvedValue(null);
        await expect(useCase.execute({ doctorId: 'doc-1' })).rejects.toThrow(NotFoundException);
    });

    it('should return doctor profile and trigger analytics event', async () => {
        doctorRepoMock.findOne.mockResolvedValue({
            id: 'doc-1',
            fullName: 'Dr. John',
            isActive: true,
            doctorClinics: [
                {
                    isActive: true,
                    consultationFee: 150,
                    clinic: { id: 'clinic-1', name: 'Main Clinic', isActive: true },
                },
                {
                    isActive: false, // Should be filtered out
                    consultationFee: 100,
                    clinic: { id: 'clinic-2', name: 'Old Clinic', isActive: true },
                }
            ],
            specialty: { id: 'spec-1', name: 'Cardiology' },
        });

        reviewRepoMock.find.mockResolvedValue([{ id: 'rev-1', patientName: 'Alice', rating: 5 }]);

        const result = await useCase.execute({ doctorId: 'doc-1', userId: 'user-1' });

        expect(result.success).toBe(true);
        expect(result.data.fullName).toBe('Dr. John');
        expect(result.data.clinics).toHaveLength(1);
        expect(result.data.clinics[0].name).toBe('Main Clinic');
        expect(result.data.reviews).toHaveLength(1);
        
        expect(outboxRepoMock.create).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'catalog.doctor_profile_viewed',
            payload: expect.objectContaining({ doctorId: 'doc-1', userId: 'user-1' })
        }));
    });
});
