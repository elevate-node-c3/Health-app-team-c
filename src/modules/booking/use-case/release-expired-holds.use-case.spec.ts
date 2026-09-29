import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReleaseExpiredHoldsUseCase } from './release-expired-holds.use-case';
import { SlotHoldEntity, SlotHoldStatus } from '../entities/slot-hold.entity';

describe('ReleaseExpiredHoldsUseCase', () => {
  let useCase: ReleaseExpiredHoldsUseCase;
  let holdRepo: any;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
      create: jest.fn().mockImplementation((_: any, dto: any) => ({ id: 'event-1', ...dto })),
    },
  };

  beforeEach(async () => {
    holdRepo = { find: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseExpiredHoldsUseCase,
        { provide: getRepositoryToken(SlotHoldEntity), useValue: holdRepo },
        { provide: DataSource, useValue: { createQueryRunner: () => mockQueryRunner } },
      ],
    }).compile();
    useCase = module.get(ReleaseExpiredHoldsUseCase);
  });

  it('returns 0 when nothing expired (idempotent)', async () => {
    holdRepo.find.mockResolvedValue([]);
    await expect(useCase.execute()).resolves.toBe(0);
  });

  it('expires holds + writes hold.expired outbox', async () => {
    const hold: any = { id: 'h1', patientId: 'p1', doctorId: 'd1', clinicId: 'c1', date: '2026-10-01', startTime: '10:00:00', status: SlotHoldStatus.ACTIVE, expiresAt: new Date(Date.now() - 60000) };
    holdRepo.find.mockResolvedValue([hold]);
    mockQueryRunner.manager.findOne.mockResolvedValue({ ...hold });
    await expect(useCase.execute()).resolves.toBe(1);
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
  });
});
