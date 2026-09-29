import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ExtendHoldUseCase } from './extend-hold.use-case';
import { SlotHoldEntity, SlotHoldStatus } from '../entities/slot-hold.entity';

describe('ExtendHoldUseCase', () => {
  let useCase: ExtendHoldUseCase;
  let holdRepo: any;

  beforeEach(async () => {
    holdRepo = { findOne: jest.fn(), save: jest.fn().mockImplementation((h: any) => Promise.resolve(h)) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtendHoldUseCase,
        { provide: getRepositoryToken(SlotHoldEntity), useValue: holdRepo },
      ],
    }).compile();
    useCase = module.get(ExtendHoldUseCase);
  });

  it('extends once by 5min', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    holdRepo.findOne.mockResolvedValue({ id: 'h1', patientId: 'p1', status: SlotHoldStatus.ACTIVE, expiresAt, extendedOnce: false });
    const result = await useCase.execute('p1', 'h1');
    expect(result.data.extendedOnce).toBe(true);
    expect(holdRepo.save).toHaveBeenCalled();
  });

  it('404 for cross-user read', async () => {
    holdRepo.findOne.mockResolvedValue({ id: 'h1', patientId: 'other', status: SlotHoldStatus.ACTIVE, expiresAt: new Date(Date.now() + 60000), extendedOnce: false });
    await expect(useCase.execute('p1', 'h1')).rejects.toThrow(NotFoundException);
  });

  it('409 when already extended', async () => {
    holdRepo.findOne.mockResolvedValue({ id: 'h1', patientId: 'p1', status: SlotHoldStatus.ACTIVE, expiresAt: new Date(Date.now() + 60000), extendedOnce: true });
    await expect(useCase.execute('p1', 'h1')).rejects.toThrow(ConflictException);
  });

  it('409 when expired', async () => {
    holdRepo.findOne.mockResolvedValue({ id: 'h1', patientId: 'p1', status: SlotHoldStatus.ACTIVE, expiresAt: new Date(Date.now() - 1000), extendedOnce: false });
    await expect(useCase.execute('p1', 'h1')).rejects.toThrow(ConflictException);
  });
});
