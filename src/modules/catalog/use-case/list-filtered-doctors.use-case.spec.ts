import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ListFilteredDoctorsUseCase } from './list-filtered-doctors.use-case';
import { DoctorEntity } from '../entities/doctor.entity';
import { ClinicEntity } from '../entities/clinic.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

jest.mock('../../../common/outbox/services/outbox-processor.service', () => ({
  OutboxProcessorService: class {},
}));
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

describe('ListFilteredDoctorsUseCase (CAT-5)', () => {
  let useCase: ListFilteredDoctorsUseCase;
  let clinicRepo: any;
  let outboxRepo: any;
  let outboxProcessor: any;
  let qb: any;
  let doctorRepo: any;

  const rows = [
    { id: 'doc-1', fullName: 'A', title: 'Professor', gender: 'Male', specialtyName: 'Cardiology', averageRating: '4.5', consultationFee: '200.00', photoUrl: null },
    { id: 'doc-2', fullName: 'B', title: 'Consultant', gender: 'Female', specialtyName: 'Cardiology', averageRating: '4.0', consultationFee: '300.00', photoUrl: null },
  ];

  beforeEach(async () => {
    qb = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      andHaving: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      clone: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue(rows),
      getQueryAndParameters: jest.fn().mockReturnValue(['SELECT 1', []]),
    };
    qb.clone.mockReturnValue(qb);
    doctorRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      query: jest.fn().mockResolvedValue([{ total: 2 }]),
    };
    clinicRepo = { findOne: jest.fn().mockResolvedValue({ id: 'clinic-1' }) };
    outboxRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn(() => Promise.resolve({ id: 'evt-1' })),
    };
    outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ListFilteredDoctorsUseCase,
        { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepo },
        { provide: getRepositoryToken(ClinicEntity), useValue: clinicRepo },
        { provide: getRepositoryToken(OutboxEventEntity), useValue: outboxRepo },
        { provide: OutboxProcessorService, useValue: outboxProcessor },
      ],
    }).compile();
    useCase = mod.get(ListFilteredDoctorsUseCase);
  });

  it('rejects city outside the chosen governorate naming the field', async () => {
    clinicRepo.findOne.mockResolvedValueOnce(null);
    const promise = useCase.execute({ filters: { governorate: 'Cairo', city: 'Dokki' } });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    try {
      await useCase.execute({ filters: { governorate: 'Cairo', city: 'Dokki' } });
    } catch (err: any) {
      expect(JSON.stringify(err.getResponse())).toContain('city');
    }
  });

  it('returns paged cards with stable id tiebreak', async () => {
    const res = await useCase.execute({ filters: { rating: 3 }, sort: 'recommended', page: 1, limit: 1 });
    expect(res.total).toBe(2);
    expect(qb.addOrderBy).toHaveBeenCalledWith('doctor.id', 'ASC');
    expect(qb.offset).toHaveBeenCalledWith(0);
  });

  it('price ascending orders by displayed fee', async () => {
    await useCase.execute({ filters: {}, sort: 'priceAsc' });
    expect(qb.orderBy).toHaveBeenCalledWith('COALESCE(MIN(dc.consultationFee), 0)', 'ASC');
  });

  it('empty result is well-formed', async () => {
    qb.getRawMany.mockResolvedValue([]);
    doctorRepo.query.mockResolvedValueOnce([{ total: 0 }]);
    const res = await useCase.execute({ filters: { rating: 5 } });
    expect(res).toEqual({ message: 'Doctors retrieved successfully', data: [], total: 0, page: 1, limit: 20 });
  });
});
