import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AiRetentionCron } from './ai-retention.cron';
import { PurgeAiRetentionUseCase } from '../use-cases/purge-ai-retention.use-case';

describe('AiRetentionCron', () => {
    let cron: AiRetentionCron;
    let purgeUseCase: jest.Mocked<PurgeAiRetentionUseCase>;

    beforeEach(async () => {
        const mockPurgeUseCase = {
            execute: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiRetentionCron,
                {
                    provide: PurgeAiRetentionUseCase,
                    useValue: mockPurgeUseCase,
                },
            ],
        }).compile();

        cron = module.get<AiRetentionCron>(AiRetentionCron);
        purgeUseCase = module.get(PurgeAiRetentionUseCase);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('handleRetentionPurge', () => {
        it('should successfully execute purge and log purged count', async () => {
            const mockResult = { purgedCount: 42 };
            purgeUseCase.execute.mockResolvedValueOnce(mockResult as any);

            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

            await cron.handleRetentionPurge();

            expect(purgeUseCase.execute).toHaveBeenCalledTimes(1);
            expect(logSpy).toHaveBeenCalledWith(
                'Starting 12-Month AI Data Retention Purge...',
            );
            expect(logSpy).toHaveBeenCalledWith(
                'Retention Purge completed successfully. Purged messages: 42',
            );
        });

        it('should catch error, log error, and not rethrow if use case fails', async () => {
            const error = new Error('Database purge timeout');
            purgeUseCase.execute.mockRejectedValueOnce(error);

            const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

            await expect(cron.handleRetentionPurge()).resolves.not.toThrow();

            expect(purgeUseCase.execute).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                'Failed to run AI Retention Purge cron job',
                error,
            );
        });
    });
});