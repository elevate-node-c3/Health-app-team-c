import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiProviderService, ChatMessage } from './ai-provider.service';
import { CapabilityExecutorService } from './capability-executor.service';
import { UserContext } from 'src/common/middleware/auth-context.middleware';

jest.mock('openai');
import OpenAI from 'openai';

describe('AiProviderService', () => {
    let service: AiProviderService;
    let capabilityExecutor: jest.Mocked<CapabilityExecutorService>;
    let mockOpenAICreate: jest.Mock;

    const mockUserCtx: UserContext = { userId: 'user-123' } as UserContext;
    const mockGuestCtx: UserContext = { deviceId: 'device-456' } as UserContext;

    async function* createAsyncStream(chunks: any[]) {
        for (const chunk of chunks) {
            yield chunk;
        }
    }

    beforeEach(async () => {
        mockOpenAICreate = jest.fn();

        (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockOpenAICreate,
                },
            },
        }));

        const mockConfigService = {
            get: jest.fn((key: string) => {
                if (key === 'OPENAI_API_KEY') return 'test-key';
                if (key === 'AI_MODEL') return 'test-model';
                return null;
            }),
        };

        const mockCapabilityExecutor = {
            executeTool: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiProviderService,
                { provide: ConfigService, useValue: mockConfigService },
                { provide: CapabilityExecutorService, useValue: mockCapabilityExecutor },
            ],
        }).compile();

        service = module.get<AiProviderService>(AiProviderService);
        capabilityExecutor = module.get(CapabilityExecutorService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('streamAnswer basic flow', () => {
        it('should stream simple assistant response and invoke onChunk for each delta', async () => {
            const chunks = [
                {
                    choices: [{ delta: { content: 'Hello ' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 1 },
                },
                {
                    choices: [{ delta: { content: 'Doctor!' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 2 },
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(chunks));

            const chunksReceived: string[] = [];
            const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];

            const result = await service.streamAnswer(
                messages,
                mockUserCtx,
                (text) => chunksReceived.push(text),
            );

            expect(chunksReceived).toEqual(['Hello ', 'Doctor!']);
            expect(result.fullText).toBe('Hello Doctor!');
            expect(result.tokensIn).toBe(10);
            expect(result.tokensOut).toBe(3);
            expect(result.finishReason).toBe('stop');
            expect(result.model).toBe('test-model');
        });

        it('should strip <SPECIALTY> tag from final text and parse fallback specialty suggestion', async () => {
            const rawText =
                'Please consult a specialist.<SPECIALTY>{"id":"cardio","name":"Cardiology"}</SPECIALTY>';
            const chunks = [
                {
                    choices: [{ delta: { content: rawText }, finish_reason: 'stop' }],
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(chunks));

            const result = await service.streamAnswer(
                [{ role: 'user', content: 'Chest pain' }],
                mockUserCtx,
                jest.fn(),
            );

            expect(result.fullText).toBe('Please consult a specialist.');
            expect(result.specialtySuggestion).toEqual({
                id: 'cardio',
                name: 'Cardiology',
            });
        });

        it('should append guest prompt instructions when user is not signed in', async () => {
            const chunks = [
                {
                    choices: [{ delta: { content: 'Guest response' }, finish_reason: 'stop' }],
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(chunks));

            await service.streamAnswer(
                [{ role: 'user', content: 'Check my bookings' }],
                mockGuestCtx,
                jest.fn(),
            );

            const passedMessages = mockOpenAICreate.mock.calls[0][0].messages;
            const systemMessage = passedMessages.find((m: any) => m.role === 'system');

            expect(systemMessage.content).toContain('GUEST (not signed in)');
        });

        it('should forward options like maxTokens to OpenAI call', async () => {
            const chunks = [
                {
                    choices: [{ delta: { content: 'Short' }, finish_reason: 'stop' }],
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(chunks));

            await service.streamAnswer(
                [{ role: 'user', content: 'Hi' }],
                mockUserCtx,
                jest.fn(),
                { maxTokens: 100 },
            );

            expect(mockOpenAICreate.mock.calls[0][0]).toMatchObject({
                max_tokens: 100,
            });
        });
    });

    describe('tool calling loop', () => {
        it('should execute tool calls from deltas and send results in the next round', async () => {
            const round1Chunks = [
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_123',
                                        function: {
                                            name: 'list_specialties',
                                            arguments: '{"limit":',
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        function: {
                                            arguments: '5}',
                                        },
                                    },
                                ],
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                },
            ];

            const round2Chunks = [
                {
                    choices: [
                        {
                            delta: { content: 'Here are the available specialties.' },
                            finish_reason: 'stop',
                        },
                    ],
                },
            ];

            mockOpenAICreate
                .mockResolvedValueOnce(createAsyncStream(round1Chunks))
                .mockResolvedValueOnce(createAsyncStream(round2Chunks));

            capabilityExecutor.executeTool.mockResolvedValueOnce([
                { id: 1, name: 'Cardiology' },
            ]);

            const onChunk = jest.fn();
            const result = await service.streamAnswer(
                [{ role: 'user', content: 'What clinics do you have?' }],
                mockUserCtx,
                onChunk,
            );

            expect(capabilityExecutor.executeTool).toHaveBeenCalledWith(
                'list_specialties',
                { limit: 5 },
                expect.objectContaining({ isGuest: false }),
            );

            expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
            const secondCallMessages = mockOpenAICreate.mock.calls[1][0].messages;

            const toolMessage = secondCallMessages.find((m: any) => m.role === 'tool');
            expect(toolMessage).toBeDefined();
            expect(toolMessage.tool_call_id).toBe('call_123');
            expect(toolMessage.content).toContain('Cardiology');

            expect(result.fullText).toBe('Here are the available specialties.');
        });

        it('should handle invalid tool JSON arguments gracefully without crashing', async () => {
            const brokenArgsChunks = [
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_broken',
                                        function: {
                                            name: 'search_doctors',
                                            arguments: '{invalid_json',
                                        },
                                    },
                                ],
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                },
            ];

            const finalChunks = [
                {
                    choices: [{ delta: { content: 'Failed to parse' }, finish_reason: 'stop' }],
                },
            ];

            mockOpenAICreate
                .mockResolvedValueOnce(createAsyncStream(brokenArgsChunks))
                .mockResolvedValueOnce(createAsyncStream(finalChunks));

            await service.streamAnswer(
                [{ role: 'user', content: 'Search' }],
                mockUserCtx,
                jest.fn(),
            );

            expect(capabilityExecutor.executeTool).not.toHaveBeenCalled();
            const secondCallMessages = mockOpenAICreate.mock.calls[1][0].messages;
            const toolMsg = secondCallMessages.find((m: any) => m.role === 'tool');
            expect(toolMsg.content).toContain('INVALID_ARGUMENTS');
        });

        it('should return TOOL_UNAVAILABLE if capabilityExecutor throws or tool fails', async () => {
            const toolChunks = [
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: 'call_err',
                                        function: {
                                            name: 'get_policy',
                                            arguments: '{}',
                                        },
                                    },
                                ],
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                },
            ];

            const finalChunks = [
                {
                    choices: [{ delta: { content: 'Policy unavailable' }, finish_reason: 'stop' }],
                },
            ];

            mockOpenAICreate
                .mockResolvedValueOnce(createAsyncStream(toolChunks))
                .mockResolvedValueOnce(createAsyncStream(finalChunks));

            capabilityExecutor.executeTool.mockRejectedValueOnce(
                new Error('DB Connection Failed'),
            );

            await service.streamAnswer(
                [{ role: 'user', content: 'Policy?' }],
                mockUserCtx,
                jest.fn(),
            );

            const secondCallMessages = mockOpenAICreate.mock.calls[1][0].messages;
            const toolMsg = secondCallMessages.find((m: any) => m.role === 'tool');
            expect(toolMsg.content).toContain('TOOL_UNAVAILABLE');
        });
    });

    describe('error classifications', () => {
        it('should throw PROVIDER_BAD_RESPONSE when response text is completely empty', async () => {
            const emptyChunks = [
                {
                    choices: [{ delta: { content: '   ' }, finish_reason: 'stop' }],
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(emptyChunks));

            await expect(
                service.streamAnswer([{ role: 'user', content: 'Hi' }], mockUserCtx, jest.fn()),
            ).rejects.toMatchObject({
                code: 'PROVIDER_BAD_RESPONSE',
            });
        });

        it('should throw PROVIDER_REFUSED when delta contains refusal', async () => {
            const refusalChunks = [
                {
                    choices: [{ delta: { refusal: 'I cannot answer this question.' } }],
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(refusalChunks));

            await expect(
                service.streamAnswer([{ role: 'user', content: 'Harmful query' }], mockUserCtx, jest.fn()),
            ).rejects.toMatchObject({
                code: 'PROVIDER_REFUSED',
            });
        });

        it('should throw PROVIDER_REFUSED when finish_reason is content_filter', async () => {
            const contentFilterChunks = [
                {
                    choices: [{ delta: { content: 'Some' }, finish_reason: 'content_filter' }],
                },
            ];

            mockOpenAICreate.mockResolvedValueOnce(createAsyncStream(contentFilterChunks));

            await expect(
                service.streamAnswer([{ role: 'user', content: 'Filter query' }], mockUserCtx, jest.fn()),
            ).rejects.toMatchObject({
                code: 'PROVIDER_REFUSED',
            });
        });

        it('should classify 429 status as PROVIDER_BUSY', async () => {
            const error429 = { status: 429, message: 'Rate limit exceeded' };
            mockOpenAICreate.mockRejectedValueOnce(error429);

            await expect(
                service.streamAnswer([{ role: 'user', content: 'Hi' }], mockUserCtx, jest.fn()),
            ).rejects.toMatchObject({
                code: 'PROVIDER_BUSY',
            });
        });

        it('should classify timeout / AbortError as PROVIDER_TIMEOUT', async () => {
            const timeoutErr = { name: 'AbortError', message: 'Request aborted' };
            mockOpenAICreate.mockRejectedValueOnce(timeoutErr);

            await expect(
                service.streamAnswer([{ role: 'user', content: 'Hi' }], mockUserCtx, jest.fn()),
            ).rejects.toMatchObject({
                code: 'PROVIDER_TIMEOUT',
            });
        });

        it('should classify general uncaught provider errors as PROVIDER_ERROR', async () => {
            const generalErr = new Error('Random openrouter 500 error');
            mockOpenAICreate.mockRejectedValueOnce(generalErr);

            await expect(
                service.streamAnswer([{ role: 'user', content: 'Hi' }], mockUserCtx, jest.fn()),
            ).rejects.toMatchObject({
                code: 'PROVIDER_ERROR',
            });
        });
    });
});