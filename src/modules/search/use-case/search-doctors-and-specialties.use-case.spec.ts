import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { SearchDoctorsAndSpecialtiesUseCase } from './search-doctors-and-specialties.use-case';
import { DoctorEntity } from '../../catalog/entities/doctor.entity';
import { SpecialtyEntity } from '../../catalog/entities/specialty.entity';

describe('SearchDoctorsAndSpecialtiesUseCase', () => {
    let useCase: SearchDoctorsAndSpecialtiesUseCase;
    let doctorRepoMock: any;
    let specialtyRepoMock: any;
    let eventEmitterMock: any;

    const mockDoctorQueryBuilder: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
    };

    const mockSpecialtyQueryBuilder: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
    };

    beforeEach(async () => {
        doctorRepoMock = {
            createQueryBuilder: jest.fn().mockReturnValue(mockDoctorQueryBuilder),
        };
        specialtyRepoMock = {
            createQueryBuilder: jest.fn().mockReturnValue(mockSpecialtyQueryBuilder),
        };
        eventEmitterMock = {
            emit: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchDoctorsAndSpecialtiesUseCase,
                { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepoMock },
                { provide: getRepositoryToken(SpecialtyEntity), useValue: specialtyRepoMock },
                { provide: EventEmitter2, useValue: eventEmitterMock },
            ],
        }).compile();

        useCase = module.get<SearchDoctorsAndSpecialtiesUseCase>(SearchDoctorsAndSpecialtiesUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw BadRequestException if query exceeds 500 characters', async () => {
        const longQuery = 'a'.repeat(501);
        await expect(
            useCase.execute({ q: longQuery }, { userId: 'user-1' }),
        ).rejects.toThrow(BadRequestException);
    });

    it('should rank prefix matches above substring matches and emit SearchPerformedEvent', async () => {
        mockSpecialtyQueryBuilder.getMany.mockResolvedValue([
            { id: '1', name: 'Neurocardiology', description: 'Brain and heart' },
            { id: '2', name: 'Cardiology', description: 'Heart care' },
        ]);

        mockDoctorQueryBuilder.getMany.mockResolvedValue([
            {
                id: 'd1',
                fullName: 'Edward Carder',
                title: 'Specialist',
                averageRating: 4.5,
                experienceYears: 10,
                isVerified: true,
                isActive: true,
                specialty: { name: 'Cardiology' },
            },
            {
                id: 'd2',
                fullName: 'Cardio Smith',
                title: 'Consultant',
                averageRating: 4.8,
                experienceYears: 15,
                isVerified: true,
                isActive: true,
                specialty: { name: 'Cardiology' },
            },
        ]);

        const res = await useCase.execute(
            { q: 'cardio', requestId: 'req-123' },
            { userId: 'user-1', clientIp: '127.0.0.1' },
        );

        expect(res.success).toBe(true);
        expect(res.metadata.requestId).toBe('req-123');
        expect(eventEmitterMock.emit).toHaveBeenCalledWith(
            'search.performed',
            expect.objectContaining({
                query: 'cardio',
                userId: 'user-1',
                resultsCount: 4,
            }),
        );

        expect(res.data.specialties[0].name).toBe('Cardiology');
        expect(res.data.doctors[0].fullName).toBe('Cardio Smith');
    });
});
