import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import { AiEventsConsumer, AiMessageAnsweredPayload } from './ai-events.consumer';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { RedisService } from 'src/common/redis/redis.service';
import { DeleteAiConversationUseCase } from '../use-cases/delete-ai-conversation.use-case';
import { AI_COST_LIMITS } from '../services/ai-quota.service';

describe('AiEventsConsumer', () => {
    let consumer: AiEventsConsumer;
    let dataSource: jest.Mocked<DataSource>;
    let processedEventsRepo: jest.Mocked<Repository<ProcessedEventEntity>>;
    let redisService: jest.Mocked<RedisService>;
    let amqpConnection: jest.Mocked<AmqpConnection>;
    let deleteConversationUseCase: jest.Mocked<DeleteAiConversationUseCase>;
    let configService: jest.Mocked<ConfigService>;
    let mockEntityManager: jest.Mocked<EntityManager>;

    const createMockAmqpMessage = (headers?: Record<string, any>): ConsumeMessage =>
    ({
        fields: {} as any,
        properties: {
            headers: headers ?? {},
        } as any,
        content: Buffer.from(''),
    } as ConsumeMessage);

    beforeEach(async () => {
        mockEntityManager = {
            findOne: jest.fn(),
            insert: jest.fn(),
        } as unknown as jest.Mocked<EntityManager>;

        dataSource = {
            transaction: jest.fn().mockImplementation(async (cb) => cb(mockEntityManager)),
            query: jest.fn(),
        } as unknown as jest.Mocked<DataSource>;

        processedEventsRepo = {} as unknown as jest.Mocked<Repository<ProcessedEventEntity>>;

        redisService = {
            incrByFloat: jest.fn().mockResolvedValue(1.0),
            expire: jest.fn().mockResolvedValue(true as any),
            get: jest.fn(),
            set: jest.fn().mockResolvedValue(true as any),
        } as unknown as jest.Mocked<RedisService>;

        amqpConnection = {
            publish: jest.fn().mockResolvedValue(true),
        } as unknown as jest.Mocked<AmqpConnection>;

        deleteConversationUseCase = {
            execute: jest.fn().mockResolvedValue({ success: true } as any),
        } as unknown as jest.Mocked<DeleteAiConversationUseCase>;

        configService = {
            get: jest.fn((key: string, defaultVal: number) => defaultVal),
        } as unknown as jest.Mocked<ConfigService>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiEventsConsumer,
                { provide: DataSource, useValue: dataSource },
                { provide: getRepositoryToken(ProcessedEventEntity), useValue: processedEventsRepo },
                { provide: RedisService, useValue: redisService },
                { provide: AmqpConnection, useValue: amqpConnection },
                { provide: DeleteAiConversationUseCase, useValue: deleteConversationUseCase },
                { provide: ConfigService, useValue: configService },
            ],
        }).compile();

        consumer = module.get<AiEventsConsumer>(AiEventsConsumer);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('handleAiMessageAnswered', () => {
        const validPayload: AiMessageAnsweredPayload = {
            conversationId: 'conv-123',
            messageId: 'msg-456',
            patientId: 'patient-789',
            tokensIn: 1_000_000, // $0.15
            tokensOut: 1_000_000, // $0.60 => Total = $0.75
            durationMs: 1500,
            specialtySuggestion: null,
        };

        it('should return Nack(false) if message payload is missing required identifiers', async () => {
            const invalidPayload = { tokensIn: 100 } as AiMessageAnsweredPayload;
            const amqpMsg = createMockAmqpMessage();

            const result = await consumer.handleAiMessageAnswered(invalidPayload, amqpMsg);

            expect(result).toBeInstanceOf(Nack);
            expect((result as Nack).requeue).toBe(false);
            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it('should skip processing if event was already processed (Idempotency check)', async () => {
            const amqpMsg = createMockAmqpMessage({ 'x-event-id': 'evt-1' });
            mockEntityManager.findOne.mockResolvedValueOnce({
                eventId: 'evt-1:ai-message-answered-analytics',
            } as any);

            await consumer.handleAiMessageAnswered(validPayload, amqpMsg);

            expect(mockEntityManager.findOne).toHaveBeenCalledWith(ProcessedEventEntity, {
                where: { eventId: 'evt-1:ai-message-answered-analytics' },
            });
            expect(redisService.incrByFloat).not.toHaveBeenCalled();
            expect(mockEntityManager.insert).not.toHaveBeenCalled();
        });

        it('should calculate cost, increment monthly spend for system & patient, and record event', async () => {
            const amqpMsg = createMockAmqpMessage({ 'x-event-id': 'evt-unique' });
            mockEntityManager.findOne.mockResolvedValueOnce(null);

            // System spend remains under 60% threshold
            redisService.incrByFloat.mockResolvedValueOnce(0.75);

            await consumer.handleAiMessageAnswered(validPayload, amqpMsg);

            // System spend tracking
            expect(redisService.incrByFloat).toHaveBeenCalledWith(
                expect.stringMatching(/^ai_spend:monthly:\d{4}-\d{2}$/),
                0.75,
            );

            // Patient spend tracking
            expect(redisService.incrByFloat).toHaveBeenCalledWith(
                expect.stringMatching(/^ai_spend:patient:patient-789:\d{4}-\d{2}$/),
                0.75,
            );

            // Idempotency event record
            expect(mockEntityManager.insert).toHaveBeenCalledWith(ProcessedEventEntity, {
                eventId: 'evt-unique:ai-message-answered-analytics',
                eventType: 'AI_MESSAGE_ANSWERED',
            });
        });

        it('should publish threshold alert event when monthly spend reaches 60%', async () => {
            const amqpMsg = createMockAmqpMessage();
            mockEntityManager.findOne.mockResolvedValueOnce(null);

            // $300 is 60% of $500 monthly spend ceiling
            const reachedSpend = AI_COST_LIMITS.MONTHLY_SPEND_CEILING_USD * 0.6;
            redisService.incrByFloat.mockResolvedValueOnce(reachedSpend);
            redisService.get.mockResolvedValueOnce(null); // alert not sent yet

            await consumer.handleAiMessageAnswered(validPayload, amqpMsg);

            expect(redisService.set).toHaveBeenCalledWith(
                expect.stringMatching(/^ai_spend_alert_sent:\d{4}-\d{2}:60$/),
                '1',
                expect.any(Number),
            );

            expect(amqpConnection.publish).toHaveBeenCalledWith(
                'ai_exchange',
                'AI_SPEND_THRESHOLD_REACHED',
                expect.objectContaining({
                    thresholdPercentage: 60,
                    currentSpendUsd: reachedSpend,
                    monthlyCeilingUsd: AI_COST_LIMITS.MONTHLY_SPEND_CEILING_USD,
                }),
            );
        });

        it('should not duplicate threshold alert if already sent', async () => {
            const amqpMsg = createMockAmqpMessage();
            mockEntityManager.findOne.mockResolvedValueOnce(null);

            const reachedSpend = AI_COST_LIMITS.MONTHLY_SPEND_CEILING_USD * 0.8;
            redisService.incrByFloat.mockResolvedValueOnce(reachedSpend);
            redisService.get.mockResolvedValue(true as any); // already sent for all thresholds

            await consumer.handleAiMessageAnswered(validPayload, amqpMsg);

            expect(redisService.set).not.toHaveBeenCalled();
            expect(amqpConnection.publish).not.toHaveBeenCalled();
        });

        it('should handle concurrent unique violation (code 23505) gracefully without Nack', async () => {
            const amqpMsg = createMockAmqpMessage({ 'x-event-id': 'evt-concurrent' });
            const uniqueViolationError = { code: '23505', message: 'duplicate key' };
            dataSource.transaction.mockRejectedValueOnce(uniqueViolationError);

            const result = await consumer.handleAiMessageAnswered(validPayload, amqpMsg);

            expect(result).toBeUndefined();
        });

        it('should return Nack(false) on unexpected processing errors to route message to DLQ', async () => {
            const amqpMsg = createMockAmqpMessage();
            dataSource.transaction.mockRejectedValueOnce(new Error('Database timeout'));

            const result = await consumer.handleAiMessageAnswered(validPayload, amqpMsg);

            expect(result).toBeInstanceOf(Nack);
            expect((result as Nack).requeue).toBe(false);
        });
    });

    describe('handlePatientAccountDeleted', () => {
        it('should query all conversations of patient and trigger deleteConversationUseCase for each', async () => {
            dataSource.query.mockResolvedValueOnce([
                { id: 'conv-1' },
                { id: 'conv-2' },
            ]);

            await consumer.handlePatientAccountDeleted({ patientId: 'patient-999' });

            expect(dataSource.query).toHaveBeenCalledWith(
                'SELECT id FROM ai_conversations WHERE patient_id = $1',
                ['patient-999'],
            );

            expect(deleteConversationUseCase.execute).toHaveBeenCalledTimes(2);
            expect(deleteConversationUseCase.execute).toHaveBeenCalledWith('conv-1', {
                userId: 'patient-999',
                role: 'PATIENT',
            });
            expect(deleteConversationUseCase.execute).toHaveBeenCalledWith('conv-2', {
                userId: 'patient-999',
                role: 'PATIENT',
            });
        });

        it('should do nothing if patientId is missing in payload', async () => {
            await consumer.handlePatientAccountDeleted({ patientId: '' });

            expect(dataSource.query).not.toHaveBeenCalled();
            expect(deleteConversationUseCase.execute).not.toHaveBeenCalled();
        });
    });

    describe('handleDeadLetter', () => {
        it('should log dead letter details from message headers without throwing', async () => {
            const amqpMsg = createMockAmqpMessage({
                'x-death': [{ count: 1, reason: 'rejected', queue: 'ai_analytics_queue' }],
            });

            await expect(
                consumer.handleDeadLetter({ messageId: 'msg-dlq' }, amqpMsg),
            ).resolves.not.toThrow();
        });
    });
});