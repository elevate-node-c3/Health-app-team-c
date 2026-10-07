import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { PurgeAiRetentionUseCase } from './purge-ai-retention.use-case';

describe('PurgeAiRetentionUseCase', () => {
    let useCase: PurgeAiRetentionUseCase;
    let dataSource: jest.Mocked<DataSource>;
    let mockEntityManager: jest.Mocked<EntityManager>;

    beforeEach(async () => {
        mockEntityManager = {
            query: jest.fn(),
        } as unknown as jest.Mocked<EntityManager>;

        dataSource = {
            transaction: jest.fn().mockImplementation(async (cb) => cb(mockEntityManager)),
        } as unknown as jest.Mocked<DataSource>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PurgeAiRetentionUseCase,
                { provide: DataSource, useValue: dataSource },
            ],
        }).compile();

        useCase = module.get<PurgeAiRetentionUseCase>(PurgeAiRetentionUseCase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('execute', () => {
        it('should run update query inside transaction and return purged count from postgres driver format [result, count]', async () => {
            mockEntityManager.query.mockResolvedValueOnce([[], 15]);

            const result = await useCase.execute();

            expect(dataSource.transaction).toHaveBeenCalledTimes(1);
            expect(mockEntityManager.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE ai_messages'),
                [expect.any(String)],
            );

            const queryArgs = mockEntityManager.query.mock.calls[0];
            expect(queryArgs).toBeDefined();

            const passedIsoDate = queryArgs?.[1]?.[0] as string;
            const parsedDate = new Date(passedIsoDate);
            const now = new Date();
            const monthDifference =
                (now.getFullYear() - parsedDate.getFullYear()) * 12 +
                (now.getMonth() - parsedDate.getMonth());

            expect(monthDifference).toBe(12);
            expect(result).toEqual({ purgedCount: 15 });
        });

        it('should return purgedCount as 0 when driver returns unexpected structure', async () => {
            mockEntityManager.query.mockResolvedValueOnce(null);

            const result = await useCase.execute();

            expect(result).toEqual({ purgedCount: 0 });
        });

        it('should rethrow error if transaction fails', async () => {
            const dbError = new Error('Database connection failed');
            mockEntityManager.query.mockRejectedValueOnce(dbError);

            await expect(useCase.execute()).rejects.toThrow('Database connection failed');
        });
    });
});