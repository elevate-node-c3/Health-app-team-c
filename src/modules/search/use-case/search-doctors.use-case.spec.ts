import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { SearchDoctorsUseCase } from './search-doctors.use-case';
import { DoctorEntity } from '../../catalog/entities/doctor.entity';
import { DoctorSortOption } from '../dto/search-doctors.dto';

describe('SearchDoctorsUseCase', () => {
    let useCase: SearchDoctorsUseCase;
    let doctorRepoMock: any;
    let eventEmitterMock: any;

    const mockQueryBuilder: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn(),
    };

    beforeEach(async () => {
        doctorRepoMock = {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        };
        eventEmitterMock = {
            emit: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchDoctorsUseCase,
                { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepoMock },
                { provide: EventEmitter2, useValue: eventEmitterMock },
            ],
        }).compile();

        useCase = module.get<SearchDoctorsUseCase>(SearchDoctorsUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should return empty list when no matches are found', async () => {
        mockQueryBuilder.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });

        const res = await useCase.execute({ q: 'nonexistent' }, {});
        
        expect(res.success).toBe(true);
        expect(res.data.doctors).toEqual([]);
        expect(res.data.nextCursor).toBeNull();
    });

    it('should return mapped doctors and a cursor if has next page', async () => {
        mockQueryBuilder.getRawAndEntities.mockResolvedValue({
            entities: [
                { id: 'd1', fullName: 'Dr. John', averageRating: 4.5, totalReviews: 10, specialty: { name: 'Cardiology' } },
                { id: 'd2', fullName: 'Dr. Jane', averageRating: 4.0, totalReviews: 5, specialty: { name: 'Cardiology' } },
            ],
            raw: [
                { d_id: 'd1', startingFee: '100.00' },
                { d_id: 'd2', startingFee: '150.00' },
            ],
        });

        const res = await useCase.execute({ limit: 1 }, { userId: 'u1' });
        
        expect(res.success).toBe(true);
        expect(res.data.doctors).toHaveLength(1);
        expect(res.data.doctors[0].fullName).toBe('Dr. John');
        expect(res.data.doctors[0].startingFee).toBe(100);
        expect(res.data.nextCursor).toBeDefined();
        expect(eventEmitterMock.emit).toHaveBeenCalledWith('results.viewed', expect.anything());
    });

    it('should decode cursor correctly and apply to query', async () => {
        mockQueryBuilder.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });
        
        const cursor = Buffer.from(JSON.stringify({ fee: 50, id: 'd0' })).toString('base64');
        
        await useCase.execute({ sort: DoctorSortOption.PRICE_ASC, cursor }, {});
        
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
            expect.stringContaining('min_fees."minFee" > :cFee'),
            expect.objectContaining({ cFee: 50, cId: 'd0' })
        );
    });
});
