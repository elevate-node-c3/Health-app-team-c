import { Test, TestingModule } from '@nestjs/testing';
import { SearchMapUseCase } from './search-map.use-case';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClinicEntity } from '../entities/clinic.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

describe('SearchMapUseCase', () => {
    let useCase: SearchMapUseCase;
    let clinicRepo: any;
    let outboxRepo: any;

    beforeEach(async () => {
        const queryBuilderMock = {
            innerJoin: jest.fn().mockReturnThis(),
            leftJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            setParameters: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue([
                {
                    clinicId: 'c1',
                    clinicName: 'Test Clinic',
                    latitude: '30.0',
                    longitude: '31.0',
                    doctorId: 'd1',
                    doctorName: 'Dr. Test',
                    specialtyName: 'Dentistry',
                    consultationFee: '500',
                    averageRating: '4.5',
                    photoUrl: 'url',
                    distanceKm: '10.5'
                }
            ]),
        };

        clinicRepo = {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
        };

        outboxRepo = {
            save: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchMapUseCase,
                {
                    provide: getRepositoryToken(ClinicEntity),
                    useValue: clinicRepo,
                },
                {
                    provide: getRepositoryToken(OutboxEventEntity),
                    useValue: outboxRepo,
                },
            ],
        }).compile();

        useCase = module.get<SearchMapUseCase>(SearchMapUseCase);
    });

    it('should calculate distance if user location is provided', async () => {
        const result = await useCase.execute({
            north: 31.0,
            south: 29.0,
            east: 32.0,
            west: 30.0,
            latitude: 30.1,
            longitude: 31.1,
        });

        expect(result.items.length).toBe(1);
        expect(result.items[0].distanceKm).toBe(10.5);
        expect(outboxRepo.save).toHaveBeenCalled();
    });

    it('should skip distance calc if user location not provided', async () => {
        const qb = clinicRepo.createQueryBuilder();
        qb.getRawMany.mockResolvedValueOnce([
            {
                clinicId: 'c1',
                clinicName: 'Test Clinic',
                latitude: '30.0',
                longitude: '31.0',
                doctorId: 'd1',
                doctorName: 'Dr. Test',
                specialtyName: 'Dentistry',
                consultationFee: '500',
                averageRating: '4.5',
                photoUrl: 'url',
                distanceKm: null
            }
        ]);

        const result = await useCase.execute({
            north: 31.0,
            south: 29.0,
            east: 32.0,
            west: 30.0,
        });

        expect(result.items[0].distanceKm).toBeNull();
        expect(qb.addSelect).toHaveBeenCalledWith('NULL', 'distanceKm');
    });
});
