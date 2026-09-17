import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RemoveFavoriteUseCase } from './remove-favorite.use-case';

jest.mock('../../../common/outbox/services/outbox-processor.service', () => ({
  OutboxProcessorService: class {},
}));
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

describe('RemoveFavoriteUseCase (CAT-7)', () => {
  let useCase: RemoveFavoriteUseCase;
  let queryRunner: any;
  let dataSource: any;
  let outboxProcessor: any;

  beforeEach(async () => {
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        delete: jest.fn(),
        create: jest.fn((_: any, dto: any) => dto),
        save: jest.fn(() => Promise.resolve({ id: 'evt-1' })),
      },
    };
    dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RemoveFavoriteUseCase,
        { provide: DataSource, useValue: dataSource },
        { provide: OutboxProcessorService, useValue: outboxProcessor },
      ],
    }).compile();
    useCase = mod.get(RemoveFavoriteUseCase);
  });

  it('removes existing favorite and publishes event', async () => {
    queryRunner.manager.delete.mockResolvedValue({ affected: 1 });

    const res = await useCase.execute('user-1', 'doc-1');

    expect(res.data).toEqual({ doctorId: 'doc-1', isFavorite: false });
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(outboxProcessor.triggerPublish).toHaveBeenCalledWith('evt-1');
  });

  it('unfavouriting a non-favorite is a no-op success with no event', async () => {
    queryRunner.manager.delete.mockResolvedValue({ affected: 0 });

    const res = await useCase.execute('user-1', 'doc-1');

    expect(res.data).toEqual({ doctorId: 'doc-1', isFavorite: false });
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(outboxProcessor.triggerPublish).not.toHaveBeenCalled();
  });
});
