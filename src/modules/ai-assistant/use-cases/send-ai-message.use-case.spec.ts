import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
    SendAiMessageUseCase,
    StartMessageCommand,
} from './send-ai-message.use-case';
import { AiProviderService } from '../services/ai-provider.service';
import { EmergencyDetectorService } from '../services/emergency-detector.service';
import { AiQuotaService } from '../services/ai-quota.service';
import {
    AiMessageEntity,
    UQ_ONE_STREAMING_PER_CONVERSATION,
} from '../entities/ai-message.entity';
import { AiConversationEntity } from '../entities/ai-conversation.entity';
import { AiMessageRole } from '../enums/ai-message-role.enum';
import { AiMessageStatus } from '../enums/ai-message-status.enum';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { UserStatus } from '../../auth/entities/user.entity';

describe('SendAiMessageUseCase', () => {
    let useCase: SendAiMessageUseCase;
    let dataSourceMock: jest.Mocked<Partial<DataSource>>;
    let entityManagerMock: {
        save: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        find: jest.Mock;
    };
    let aiProviderServiceMock: jest.Mocked<Partial<AiProviderService>>;
    let emergencyDetectorServiceMock: jest.Mocked<Partial<EmergencyDetectorService>>;
    let quotaServiceMock: jest.Mocked<Partial<AiQuotaService>>;

    const mockUserContext: UserContext = {
        userId: 'user-123',
        deviceId: 'device-abc',
        role: UserStatus.PATIENT,
    } as UserContext;

    const mockConversation: AiConversationEntity = {
        id: 'conv-123',
        patientId: 'user-123',
        deviceId: 'device-abc',
        createdAt: new Date(),
        updatedAt: new Date(),
    } as AiConversationEntity;

    const mockUserMessage: AiMessageEntity = {
        id: 'msg-user-1',
        conversationId: 'conv-123',
        role: AiMessageRole.USER,
        content: 'Hello doctor',
        status: AiMessageStatus.SUCCESS,
        createdAt: new Date(),
        updatedAt: new Date(),
    } as AiMessageEntity;

    const mockAssistantMessage: AiMessageEntity = {
        id: 'msg-assistant-1',
        conversationId: 'conv-123',
        role: AiMessageRole.ASSISTANT,
        content: '',
        status: AiMessageStatus.STREAMING,
        parentMessageId: 'msg-user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
    } as AiMessageEntity;

    beforeEach(async () => {
        entityManagerMock = {
            save: jest.fn(),
            create: jest.fn().mockImplementation((entity, dto) => ({ id: dto?.id || 'generated-id', ...dto })),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            find: jest.fn().mockResolvedValue([]),
        };

        dataSourceMock = {
            getRepository: jest.fn(),
            transaction: jest.fn().mockImplementation(async (cb) => cb(entityManagerMock as unknown as EntityManager)),
        };

        aiProviderServiceMock = {
            streamAnswer: jest.fn().mockResolvedValue({
                fullText: 'Hello, how can I help you?',
                tokensIn: 10,
                tokensOut: 15,
                model: 'gpt-4o',
                specialtySuggestion: null,
            }),
        };

        emergencyDetectorServiceMock = {
            detectEmergency: jest.fn().mockReturnValue({
                isEmergency: false,
                rulesVersion: '1.0',
            }),
        };

        quotaServiceMock = {
            consume: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SendAiMessageUseCase,
                { provide: DataSource, useValue: dataSourceMock },
                { provide: AiProviderService, useValue: aiProviderServiceMock },
                { provide: EmergencyDetectorService, useValue: emergencyDetectorServiceMock },
                { provide: AiQuotaService, useValue: quotaServiceMock },
            ],
        }).compile();

        useCase = module.get<SendAiMessageUseCase>(SendAiMessageUseCase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('start()', () => {
        it('should throw ForbiddenException if neither userId nor deviceId is present in UserContext', async () => {
            const command: StartMessageCommand = {
                message: 'Hello',
                userContext: {} as UserContext,
            };

            await expect(useCase.start(command)).rejects.toThrow(ForbiddenException);
        });

        it('should return replayed message directly if clientMessageId was previously processed (Replay / Idempotency)', async () => {
            const mockRepo = {
                createQueryBuilder: jest.fn().mockReturnValue({
                    innerJoin: jest.fn().mockReturnThis(),
                    where: jest.fn().mockReturnThis(),
                    andWhere: jest.fn().mockReturnThis(),
                    getOne: jest.fn().mockResolvedValue(mockUserMessage),
                }),
                findOne: jest.fn().mockResolvedValue({
                    id: 'msg-assistant-replay',
                    isEmergency: false,
                }),
            };
            (dataSourceMock.getRepository as jest.Mock).mockReturnValue(mockRepo);

            const command: StartMessageCommand = {
                clientMessageId: 'client-msg-123',
                message: 'Hello',
                userContext: mockUserContext,
            };

            const result = await useCase.start(command);

            expect(result).toEqual({
                conversationId: 'conv-123',
                messageId: 'msg-assistant-replay',
                isEmergency: false,
                replayed: true,
            });
            expect(quotaServiceMock.consume).not.toHaveBeenCalled();
            expect(aiProviderServiceMock.streamAnswer).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException when non-existing or unauthorized conversationId is provided', async () => {
            const mockRepo = {
                findOne: jest.fn().mockResolvedValue(null),
            };
            (dataSourceMock.getRepository as jest.Mock).mockReturnValue(mockRepo);

            const command: StartMessageCommand = {
                conversationId: 'non-existing-conv',
                message: 'Hello',
                userContext: mockUserContext,
            };

            await expect(useCase.start(command)).rejects.toThrow(NotFoundException);
        });

        it('should handle medical emergency detection and override AI generation without consuming quota', async () => {
            emergencyDetectorServiceMock.detectEmergency = jest.fn().mockReturnValue({
                isEmergency: true,
                rulesVersion: '1.0',
                ruleTriggered: { id: 'rule-chest-pain', category: 'CARDIAC' },
                overrideResponse: 'Please call emergency services immediately!',
            });

            entityManagerMock.save
                .mockResolvedValueOnce(mockConversation)
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce(mockUserMessage)
                .mockResolvedValueOnce({ ...mockAssistantMessage, id: 'msg-emergency-assistant' })
                .mockResolvedValueOnce({});

            const command: StartMessageCommand = {
                message: 'I have severe chest pain',
                userContext: mockUserContext,
            };

            const result = await useCase.start(command);

            expect(result.isEmergency).toBe(true);
            expect(result.replayed).toBe(false);
            expect(quotaServiceMock.consume).not.toHaveBeenCalled();
            expect(aiProviderServiceMock.streamAnswer).not.toHaveBeenCalled();
            expect(entityManagerMock.save).toHaveBeenCalledTimes(5);
        });

        it('should throw ConflictException if conversation currently has an active streaming turn (assertNotBusy)', async () => {
            const mockConvRepo = {
                findOne: jest.fn().mockResolvedValue(mockConversation),
            };
            const mockMsgRepo = {
                count: jest.fn().mockResolvedValue(1),
            };

            (dataSourceMock.getRepository as jest.Mock).mockImplementation((entity) => {
                if (entity === AiConversationEntity) return mockConvRepo;
                if (entity === AiMessageEntity) return mockMsgRepo;
                return {};
            });

            const command: StartMessageCommand = {
                conversationId: 'conv-123',
                message: 'any text',
                userContext: mockUserContext,
            };

            await expect(useCase.start(command)).rejects.toThrow(ConflictException);
            expect(quotaServiceMock.consume).not.toHaveBeenCalled();
        });

        it('should handle the complete flow successfully (Successful Flow) with sensitive data filtering (Sanitization)', async () => {
            const mockConvRepo = {
                findOne: jest.fn().mockResolvedValue(mockConversation),
            };
            const mockMsgRepo = {
                count: jest.fn().mockResolvedValue(0),
                find: jest.fn().mockResolvedValue([]),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
            };

            (dataSourceMock.getRepository as jest.Mock).mockImplementation((entity) => {
                if (entity === AiConversationEntity) return mockConvRepo;
                if (entity === AiMessageEntity) return mockMsgRepo;
                return {};
            });

            entityManagerMock.save
                .mockResolvedValueOnce(mockUserMessage)
                .mockResolvedValueOnce(mockAssistantMessage);

            const command: StartMessageCommand = {
                conversationId: 'conv-123',
                message: 'password [PASSWORD] and credit card [CREDIT_CARD] i need  a doctor',
                userContext: mockUserContext,
            };

            const result = await useCase.start(command);

            expect(result).toEqual({
                conversationId: 'conv-123',
                messageId: mockAssistantMessage.id,
                isEmergency: false,
                replayed: false,
            });

            expect(quotaServiceMock.consume).toHaveBeenCalledWith(mockUserContext);

            expect(entityManagerMock.create).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    content: 'password [PASSWORD] and credit card [CREDIT_CARD] i need  a doctor',
                }),
            );
        });

        it('should handle unique constraint exception (CONVERSATION_BUSY) during turn save', async () => {
            const mockConvRepo = {
                findOne: jest.fn().mockResolvedValue(mockConversation),
            };
            const mockMsgRepo = {
                count: jest.fn().mockResolvedValue(0),
            };

            (dataSourceMock.getRepository as jest.Mock).mockImplementation((entity) => {
                if (entity === AiConversationEntity) return mockConvRepo;
                if (entity === AiMessageEntity) return mockMsgRepo;
                return {};
            });

            const uniqueError = {
                code: '23505',
                constraint: UQ_ONE_STREAMING_PER_CONVERSATION,
            };
            (dataSourceMock.transaction as jest.Mock).mockRejectedValueOnce(uniqueError);

            const command: StartMessageCommand = {
                conversationId: 'conv-123',
                message: 'Hello',
                userContext: mockUserContext,
            };

            await expect(useCase.start(command)).rejects.toThrow(ConflictException);
        });
    });
});