import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { DeleteAiConversationUseCase } from './delete-ai-conversation.use-case';
import { AiConversationEntity } from '../entities/ai-conversation.entity';
import { AiMessageEntity } from '../entities/ai-message.entity';
import { OutboxEventEntity, OutboxEventStatus } from 'src/common/outbox/entities/outbox-event.entity';
import { UserContext } from 'src/common/middleware/auth-context.middleware';

describe('DeleteAiConversationUseCase', () => {
    let useCase: DeleteAiConversationUseCase;
    let dataSource: jest.Mocked<DataSource>;
    let convRepo: jest.Mocked<Repository<AiConversationEntity>>;
    let mockEntityManager: jest.Mocked<EntityManager>;

    const mockUserCtx: UserContext = {
        userId: 'user-123',
        role: 'PATIENT',
    } as unknown as UserContext;

    const mockGuestCtx: UserContext = {
        deviceId: 'device-456',
        role: 'GUEST',
    } as unknown as UserContext;

    beforeEach(async () => {
        mockEntityManager = {
            delete: jest.fn().mockResolvedValue({ affected: 1 } as any),
            create: jest.fn().mockImplementation((_, entity) => entity),
            save: jest.fn().mockResolvedValue({} as any),
        } as unknown as jest.Mocked<EntityManager>;

        convRepo = {
            findOne: jest.fn(),
        } as unknown as jest.Mocked<Repository<AiConversationEntity>>;

        dataSource = {
            getRepository: jest.fn().mockReturnValue(convRepo),
            transaction: jest.fn().mockImplementation(async (cb) => cb(mockEntityManager)),
        } as unknown as jest.Mocked<DataSource>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DeleteAiConversationUseCase,
                { provide: DataSource, useValue: dataSource },
            ],
        }).compile();

        useCase = module.get<DeleteAiConversationUseCase>(DeleteAiConversationUseCase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Identity & Ownership Validation', () => {
        it('should throw ForbiddenException if userContext lacks both userId and deviceId', async () => {
            const invalidCtx = {} as UserContext;

            await expect(useCase.execute('conv-1', invalidCtx)).rejects.toThrow(
                ForbiddenException,
            );
            expect(convRepo.findOne).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException if conversation does not exist or user is not the owner', async () => {
            convRepo.findOne.mockResolvedValueOnce(null);

            await expect(useCase.execute('conv-1', mockUserCtx)).rejects.toThrow(
                NotFoundException,
            );

            expect(convRepo.findOne).toHaveBeenCalledWith({
                where: { id: 'conv-1', patientId: 'user-123' },
            });
            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it('should query guest conversation matching deviceId and patientId IS NULL', async () => {
            convRepo.findOne.mockResolvedValueOnce(null);

            await expect(useCase.execute('conv-guest', mockGuestCtx)).rejects.toThrow(
                NotFoundException,
            );

            expect(convRepo.findOne).toHaveBeenCalledWith({
                where: {
                    id: 'conv-guest',
                    patientId: IsNull(),
                    deviceId: 'device-456',
                },
            });
        });
    });

    describe('Transaction & Outbox Execution', () => {
        it('should perform hard delete on messages and conversation, and record outbox event for signed-in patient', async () => {
            const mockConversation = { id: 'conv-1', patientId: 'user-123' } as AiConversationEntity;
            convRepo.findOne.mockResolvedValueOnce(mockConversation);

            await useCase.execute('conv-1', mockUserCtx);

            expect(dataSource.transaction).toHaveBeenCalledTimes(1);

            expect(mockEntityManager.delete).toHaveBeenCalledWith(AiMessageEntity, {
                conversationId: 'conv-1',
            });

            expect(mockEntityManager.delete).toHaveBeenCalledWith(AiConversationEntity, {
                id: 'conv-1',
            });

            expect(mockEntityManager.create).toHaveBeenCalledWith(
                OutboxEventEntity,
                expect.objectContaining({
                    aggregateType: 'AI_CONVERSATION',
                    eventType: 'AI_CONVERSATION_DELETED',
                    exchange: 'ai_exchange',
                    status: OutboxEventStatus.PENDING,
                    payload: expect.objectContaining({
                        conversationId: 'conv-1',
                        patientId: 'user-123',
                        deviceId: null,
                        deletedAt: expect.any(String),
                    }),
                }),
            );

            expect(mockEntityManager.save).toHaveBeenCalledTimes(1);
        });

        it('should perform hard delete and record outbox event for guest user', async () => {
            const mockConversation = {
                id: 'conv-2',
                patientId: null,
                deviceId: 'device-456',
            } as AiConversationEntity;
            convRepo.findOne.mockResolvedValueOnce(mockConversation);

            await useCase.execute('conv-2', mockGuestCtx);

            expect(mockEntityManager.delete).toHaveBeenCalledWith(AiMessageEntity, {
                conversationId: 'conv-2',
            });
            expect(mockEntityManager.delete).toHaveBeenCalledWith(AiConversationEntity, {
                id: 'conv-2',
            });

            expect(mockEntityManager.create).toHaveBeenCalledWith(
                OutboxEventEntity,
                expect.objectContaining({
                    payload: expect.objectContaining({
                        conversationId: 'conv-2',
                        patientId: null,
                        deviceId: 'device-456',
                    }),
                }),
            );

            expect(mockEntityManager.save).toHaveBeenCalledTimes(1);
        });
    });
});