import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { firstValueFrom, toArray } from 'rxjs';
import { AiMessageTailService } from './ai-message-tail.service';
import { AiMessageEntity } from '../entities/ai-message.entity';
import { AiMessageStatus } from '../enums/ai-message-status.enum';
import { AiMessageRole } from '../enums/ai-message-role.enum';
import { UserContext } from 'src/common/middleware/auth-context.middleware';

describe('AiMessageTailService', () => {
    let service: AiMessageTailService;
    let dataSource: jest.Mocked<DataSource>;
    let messageRepo: jest.Mocked<Repository<AiMessageEntity>>;
    let queryBuilder: jest.Mocked<SelectQueryBuilder<AiMessageEntity>>;

    const mockUserCtx: UserContext = { userId: 'user-123' } as UserContext;
    const mockDeviceCtx: UserContext = { deviceId: 'device-456' } as UserContext;
    const mockEmptyCtx: UserContext = {} as UserContext;

    const createMockMessage = (overrides?: Partial<AiMessageEntity>): AiMessageEntity =>
    ({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.SUCCESS,
        content: 'Hello, how can I help?',
        specialtySuggestion: null,
        isEmergency: false,
        errorCode: null,
        updatedAt: new Date(),
        ...overrides,
    } as unknown as AiMessageEntity);

    beforeEach(async () => {
        queryBuilder = {
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
        } as unknown as jest.Mocked<SelectQueryBuilder<AiMessageEntity>>;

        messageRepo = {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
            findOne: jest.fn(),
            update: jest.fn(),
        } as unknown as jest.Mocked<Repository<AiMessageEntity>>;

        dataSource = {
            getRepository: jest.fn().mockReturnValue(messageRepo),
        } as unknown as jest.Mocked<DataSource>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiMessageTailService,
                {
                    provide: DataSource,
                    useValue: dataSource,
                },
            ],
        }).compile();

        service = module.get<AiMessageTailService>(AiMessageTailService);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    describe('findOwnedAssistantMessage (via getSnapshot)', () => {
        it('should throw NotFoundException if context has neither userId nor deviceId', async () => {
            await expect(service.getSnapshot('msg-1', mockEmptyCtx)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should throw NotFoundException if queryBuilder returns null', async () => {
            queryBuilder.getOne.mockResolvedValue(null);

            await expect(service.getSnapshot('msg-1', mockUserCtx)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should query by userId when userCtx is provided', async () => {
            const mockMsg = createMockMessage();
            queryBuilder.getOne.mockResolvedValue(mockMsg);

            await service.getSnapshot('msg-1', mockUserCtx);

            expect(queryBuilder.andWhere).toHaveBeenCalledWith('c.patientId = :uid', {
                uid: 'user-123',
            });
        });

        it('should query by deviceId when deviceCtx is provided without userId', async () => {
            const mockMsg = createMockMessage();
            queryBuilder.getOne.mockResolvedValue(mockMsg);

            await service.getSnapshot('msg-1', mockDeviceCtx);

            expect(queryBuilder.andWhere).toHaveBeenCalledWith('c.patientId IS NULL');
            expect(queryBuilder.andWhere).toHaveBeenCalledWith('c.deviceId = :did', {
                did: 'device-456',
            });
        });
    });

    describe('getSnapshot', () => {
        it('should return a successful snapshot for a completed message', async () => {
            const mockMsg = createMockMessage({
                status: AiMessageStatus.SUCCESS,
                content: 'Completed diagnostic answer.',
            });
            queryBuilder.getOne.mockResolvedValue(mockMsg);

            const result = await service.getSnapshot('msg-1', mockUserCtx);

            expect(result).toEqual({
                messageId: 'msg-1',
                conversationId: 'conv-1',
                status: AiMessageStatus.SUCCESS,
                text: 'Completed diagnostic answer.',
                specialtySuggestion: null,
                isEmergency: false,
                error: null,
            });
        });

        it('should mark message as PARTIAL/FAILED if stale STREAMING exists', async () => {
            const staleDate = new Date(Date.now() - 50_000); // > STALE_STREAM_MS (45s)
            const staleMsg = createMockMessage({
                status: AiMessageStatus.STREAMING,
                content: 'Partial generation text...<SPECIALTY>Cardiology',
                updatedAt: staleDate,
            });
            const updatedMsg = createMockMessage({
                status: AiMessageStatus.PARTIAL,
                content: 'Partial generation text...',
                errorCode: 'GENERATION_INTERRUPTED',
            });

            queryBuilder.getOne.mockResolvedValue(staleMsg);
            messageRepo.update.mockResolvedValue({} as any);
            messageRepo.findOne.mockResolvedValue(updatedMsg);

            const result = await service.getSnapshot('msg-1', mockUserCtx);

            expect(messageRepo.update).toHaveBeenCalledWith(
                { id: 'msg-1', status: AiMessageStatus.STREAMING },
                {
                    content: 'Partial generation text...',
                    status: AiMessageStatus.PARTIAL,
                    errorCode: 'GENERATION_INTERRUPTED',
                },
            );
            expect(result.status).toBe(AiMessageStatus.PARTIAL);
            expect(result.text).toBe('Partial generation text...');
            expect(result.error).toBeDefined();
        });
    });

    describe('openTail', () => {
        it('should emit "start" event first if startInfo is provided', async () => {
            const mockMsg = createMockMessage({ status: AiMessageStatus.SUCCESS });
            queryBuilder.getOne.mockResolvedValue(mockMsg);
            messageRepo.findOne.mockResolvedValue(mockMsg);

            const stream$ = await service.openTail('msg-1', mockUserCtx, 0, {
                conversationId: 'conv-1',
                replayed: false,
            });

            const firstEvent = await firstValueFrom(stream$);

            expect(firstEvent).toEqual({
                type: 'start',
                data: { conversationId: 'conv-1', messageId: 'msg-1', replayed: false },
            });
        });

        it('should emit chunk from offset, then done when message status is SUCCESS', async () => {
            const mockMsg = createMockMessage({
                status: AiMessageStatus.SUCCESS,
                content: 'ABCDEF',
            });
            queryBuilder.getOne.mockResolvedValue(mockMsg);
            messageRepo.findOne.mockResolvedValue(mockMsg);

            const stream$ = await service.openTail('msg-1', mockUserCtx, 2);
            const events = await firstValueFrom(stream$.pipe(toArray()));

            expect(events).toEqual([
                {
                    id: '6',
                    type: 'chunk',
                    data: { text: 'CDEF' },
                },
                {
                    type: 'done',
                    data: {
                        messageId: 'msg-1',
                        conversationId: 'conv-1',
                        text: 'ABCDEF',
                        specialtySuggestion: null,
                        isEmergency: false,
                    },
                },
            ]);
        });

        it('should emit error event and complete if message row is deleted/missing in poll', async () => {
            const mockMsg = createMockMessage({ status: AiMessageStatus.STREAMING });
            queryBuilder.getOne.mockResolvedValue(mockMsg);
            messageRepo.findOne.mockResolvedValue(null);

            const stream$ = await service.openTail('msg-1', mockUserCtx, 0);
            const events = await firstValueFrom(stream$.pipe(toArray()));

            expect(events[0].type).toBe('error');
            expect(events[0].data).toHaveProperty('code');
        });

        it('should emit error event when generation finishes with FAILED status', async () => {
            const failedMsg = createMockMessage({
                status: AiMessageStatus.FAILED,
                content: 'Something broke',
                errorCode: 'PROVIDER_ERROR',
            });
            queryBuilder.getOne.mockResolvedValue(failedMsg);
            messageRepo.findOne.mockResolvedValue(failedMsg);

            const stream$ = await service.openTail('msg-1', mockUserCtx, 0);
            const events = await firstValueFrom(stream$.pipe(toArray()));

            const errorEvent = events.find((e) => e.type === 'error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.data).toMatchObject({
                code: 'PROVIDER_ERROR',
                partialText: 'Something broke',
            });
        });

        it('should emit periodic ping and handle poll progression under fake timers', async () => {
            jest.useFakeTimers();

            const streamingMsg = createMockMessage({
                status: AiMessageStatus.STREAMING,
                content: 'Part1',
            });
            const completedMsg = createMockMessage({
                status: AiMessageStatus.SUCCESS,
                content: 'Part1 and Part2',
            });

            queryBuilder.getOne.mockResolvedValue(streamingMsg);

            messageRepo.findOne.mockImplementation(async () => {
                if (Date.now() >= 15_000) {
                    return completedMsg;
                }
                return streamingMsg;
            });

            const stream$ = await service.openTail('msg-1', mockUserCtx, 0);
            const received: any[] = [];
            const sub = stream$.subscribe({
                next: (ev) => received.push(ev),
            });

            await jest.advanceTimersByTimeAsync(0);
            expect(received).toHaveLength(1);
            expect(received[0].type).toBe('chunk');

            await jest.advanceTimersByTimeAsync(15_000);
            expect(received.some((e) => e.type === 'ping')).toBe(true);

            await jest.advanceTimersByTimeAsync(400);
            expect(received.some((e) => e.type === 'done')).toBe(true);

            sub.unsubscribe();
        });

        it('should complete stream when MAX_TAIL_MS is exceeded', async () => {
            jest.useFakeTimers();

            const streamingMsg = createMockMessage({
                status: AiMessageStatus.STREAMING,
                content: 'Still generating...',
            });
            queryBuilder.getOne.mockResolvedValue(streamingMsg);
            messageRepo.findOne.mockResolvedValue(streamingMsg);

            const stream$ = await service.openTail('msg-1', mockUserCtx, 0);
            let isCompleted = false;
            const sub = stream$.subscribe({
                complete: () => {
                    isCompleted = true;
                },
            });

            await jest.advanceTimersByTimeAsync(0);

            const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 125_000);

            await jest.advanceTimersByTimeAsync(400);

            expect(isCompleted).toBe(true);

            nowSpy.mockRestore();
            sub.unsubscribe();
        });
    });
});