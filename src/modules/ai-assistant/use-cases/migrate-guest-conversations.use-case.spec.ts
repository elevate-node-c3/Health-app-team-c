import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { MigrateGuestConversationsUseCase } from './migrate-guest-conversations.use-case';
import { AiConversationEntity } from '../entities/ai-conversation.entity';

describe('MigrateGuestConversationsUseCase', () => {
    let useCase: MigrateGuestConversationsUseCase;
    let conversationRepo: jest.Mocked<Repository<AiConversationEntity>>;

    beforeEach(async () => {
        conversationRepo = {
            update: jest.fn(),
        } as unknown as jest.Mocked<Repository<AiConversationEntity>>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MigrateGuestConversationsUseCase,
                {
                    provide: getRepositoryToken(AiConversationEntity),
                    useValue: conversationRepo,
                },
            ],
        }).compile();

        useCase = module.get<MigrateGuestConversationsUseCase>(
            MigrateGuestConversationsUseCase,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('execute', () => {
        it('should return 0 immediately if deviceId is missing or empty', async () => {
            const result = await useCase.execute('', 'user-123');

            expect(result).toBe(0);
            expect(conversationRepo.update).not.toHaveBeenCalled();
        });

        it('should return 0 immediately if userId is missing or empty', async () => {
            const result = await useCase.execute('device-456', '');

            expect(result).toBe(0);
            expect(conversationRepo.update).not.toHaveBeenCalled();
        });

        it('should update guest conversations matching deviceId and patientId IS NULL, and return affected count', async () => {
            conversationRepo.update.mockResolvedValueOnce({
                affected: 4,
                raw: {},
                generatedMaps: [],
            });

            const result = await useCase.execute('device-456', 'user-123');

            expect(conversationRepo.update).toHaveBeenCalledWith(
                {
                    deviceId: 'device-456',
                    patientId: IsNull(),
                },
                {
                    patientId: 'user-123',
                },
            );
            expect(result).toBe(4);
        });

        it('should return 0 if result.affected is undefined or zero', async () => {
            conversationRepo.update.mockResolvedValueOnce({
                affected: undefined,
                raw: {},
                generatedMaps: [],
            });

            const result = await useCase.execute('device-456', 'user-123');

            expect(result).toBe(0);
        });
    });
});