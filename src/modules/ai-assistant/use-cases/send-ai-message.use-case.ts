import {
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import {
    AiMessageEntity,
    UQ_CLIENT_MESSAGE_ID,
    UQ_ONE_STREAMING_PER_CONVERSATION,
} from '../entities/ai-message.entity';
import { AiConversationEntity } from '../entities/ai-conversation.entity';
import { AiMessageRole } from '../enums/ai-message-role.enum';
import { AiMessageStatus } from '../enums/ai-message-status.enum';
import { AiProviderService, ChatMessage } from '../services/ai-provider.service';
import { EmergencyCheckResult, EmergencyDetectorService } from '../services/emergency-detector.service';
import { AiQuotaService, AI_COST_LIMITS } from '../services/ai-quota.service';
import { toAiErrorCode } from '../errors/ai-provider.error';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { OutboxEventEntity, OutboxEventStatus } from 'src/common/outbox/entities/outbox-event.entity';

export interface StartMessageCommand {
    conversationId?: string;
    message: string;
    clientMessageId?: string;
    userContext: UserContext;
}

export interface StartedMessage {
    conversationId: string;
    messageId: string;
    isEmergency: boolean;
    replayed: boolean;
}

const FLUSH_INTERVAL_MS = 500;
export const STALE_STREAM_MS = 45_000;
const HISTORY_MAX_MESSAGES = 8;
const HISTORY_MAX_CHARS = 6_000;

@Injectable()
export class SendAiMessageUseCase {
    private readonly logger = new Logger(SendAiMessageUseCase.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly aiProviderService: AiProviderService,
        private readonly emergencyDetectorService: EmergencyDetectorService,
        private readonly quotaService: AiQuotaService,
    ) { }

    async start(command: StartMessageCommand): Promise<StartedMessage> {
        const { conversationId: requestedConvId, message, clientMessageId, userContext } = command;

        if (!userContext?.userId && !userContext?.deviceId) {
            throw new ForbiddenException({ code: 'AUTH_IDENTITY_MISSING' });
        }

        const emergency = this.emergencyDetectorService.detectEmergency(message);

        if (clientMessageId) {
            const replay = await this.findReplay(clientMessageId, userContext);
            if (replay) return { ...replay, replayed: true };
        }

        const conversation = requestedConvId
            ? await this.findOwnedConversation(requestedConvId, userContext)
            : null;

        if (requestedConvId && !conversation && !emergency.isEmergency) {
            throw new NotFoundException({ code: 'AI_CONVERSATION_NOT_FOUND' });
        }

        if (emergency.isEmergency) {
            return this.persistEmergencyTurn({ conversation, message, clientMessageId, userContext, emergency });
        }

        if (conversation) await this.assertNotBusy(conversation.id);

        await this.quotaService.consume(userContext);

        const sanitizedMessage = this.sanitizeInputText(message);

        let turn: { conversationId: string; userMessageId: string; assistantMessageId: string };
        try {
            turn = await this.persistStreamingTurn({ conversation, message: sanitizedMessage, clientMessageId, userContext });
        } catch (err) {
            if (this.isUniqueViolation(err, UQ_ONE_STREAMING_PER_CONVERSATION)) {
                throw new ConflictException({
                    code: 'CONVERSATION_BUSY',
                    messageKey: 'errors.ai.conversation_busy',
                    message: 'Another message is still being answered in this conversation.',
                });
            }
            if (clientMessageId && this.isUniqueViolation(err, UQ_CLIENT_MESSAGE_ID)) {
                const replay = await this.findReplay(clientMessageId, userContext);
                if (replay) return { ...replay, replayed: true };
            }
            throw err;
        }

        void this.generate({
            conversationId: turn.conversationId,
            assistantMessageId: turn.assistantMessageId,
            userMessageId: turn.userMessageId,
            message: sanitizedMessage,
            userContext,
        }).catch((err) => this.logger.error(`Unhandled generation error: ${err?.message}`, err?.stack));

        return {
            conversationId: turn.conversationId,
            messageId: turn.assistantMessageId,
            isEmergency: false,
            replayed: false,
        };
    }


    private async generate(params: {
        conversationId: string;
        assistantMessageId: string;
        userMessageId: string;
        message: string;
        userContext: UserContext;
    }): Promise<void> {
        const { conversationId, assistantMessageId, userMessageId, message, userContext } = params;
        const repo = this.dataSource.getRepository(AiMessageEntity);
        const startedAt = Date.now();

        let text = '';
        let flushing: Promise<void> | null = null;

        const timer = setInterval(() => {
            if (flushing) return;
            flushing = repo
                .update(assistantMessageId, { content: text, updatedAt: new Date() })
                .then(() => undefined)
                .catch((e) => this.logger.warn(`Flush failed: ${e?.message}`))
                .finally(() => {
                    flushing = null;
                });
        }, FLUSH_INTERVAL_MS);

        const stopFlushing = async () => {
            clearInterval(timer);
            if (flushing) await flushing;
        };

        try {
            const history = await this.getBoundedHistory(conversationId, [userMessageId, assistantMessageId]);
            const messagesForAi: ChatMessage[] = [...history, { role: 'user', content: message }];

            const result = await this.aiProviderService.streamAnswer(
                messagesForAi,
                userContext,
                (chunk) => { text += chunk; },
                { maxTokens: AI_COST_LIMITS.MAX_TOKENS_PER_MESSAGE }
            );

            await stopFlushing();
            const durationMs = Date.now() - startedAt;

            await this.dataSource.transaction(async (manager) => {
                await manager.update(AiMessageEntity, assistantMessageId, {
                    content: result.fullText,
                    status: AiMessageStatus.SUCCESS,
                    specialtySuggestion: result.specialtySuggestion,
                    tokensIn: result.tokensIn,
                    tokensOut: result.tokensOut,
                    durationMs,
                    model: result.model,
                    errorCode: null,
                });

                await this.saveOutbox(manager, 'AI_MESSAGE', 'AI_MESSAGE_ANSWERED', {
                    conversationId,
                    messageId: assistantMessageId,
                    patientId: userContext.userId || null,
                    deviceId: userContext.deviceId || null,
                    model: result.model,
                    tokensIn: result.tokensIn,
                    tokensOut: result.tokensOut,
                    durationMs,
                    specialtySuggestion: result.specialtySuggestion,
                    timestamp: new Date().toISOString(),
                });
            });
        } catch (err) {
            await stopFlushing();

            const errorCode = toAiErrorCode(err);
            const partial = this.stripSpecialtyTag(text).trim();

            this.logger.warn(`Generation failed for message ${assistantMessageId}: ${errorCode}`);

            await repo
                .update(assistantMessageId, {
                    content: partial,
                    status: partial ? AiMessageStatus.PARTIAL : AiMessageStatus.FAILED,
                    errorCode,
                    durationMs: Date.now() - startedAt,
                })
                .catch((e) => this.logger.error(`Could not record failure: ${e?.message}`));
        }
    }


    private async persistStreamingTurn(params: {
        conversation: AiConversationEntity | null;
        message: string;
        clientMessageId?: string;
        userContext: UserContext;
    }) {
        const { conversation, message, clientMessageId, userContext } = params;

        return this.dataSource.transaction(async (manager) => {
            const conversationId = await this.ensureConversation(manager, conversation, userContext);
            if (conversation) await this.failStaleStreaming(manager, conversationId);

            const userMsg = await manager.save(
                manager.create(AiMessageEntity, {
                    conversationId,
                    role: AiMessageRole.USER,
                    content: message,
                    status: AiMessageStatus.SUCCESS,
                    clientMessageId: clientMessageId ?? null,
                }),
            );

            const assistantMsg = await manager.save(
                manager.create(AiMessageEntity, {
                    conversationId,
                    role: AiMessageRole.ASSISTANT,
                    content: '',
                    status: AiMessageStatus.STREAMING,
                    parentMessageId: userMsg.id,
                }),
            );

            return {
                conversationId,
                userMessageId: userMsg.id,
                assistantMessageId: assistantMsg.id,
            };
        });
    }

    private async persistEmergencyTurn(params: {
        conversation: AiConversationEntity | null;
        message: string;
        clientMessageId?: string;
        userContext: UserContext;
        emergency: EmergencyCheckResult;
    }): Promise<StartedMessage> {
        const { conversation, message, clientMessageId, userContext, emergency } = params;
        const rule = emergency.ruleTriggered;

        this.logger.warn(`🚨 [Emergency] rule=${rule?.id} v${emergency.rulesVersion}`);

        return this.dataSource.transaction(async (manager) => {
            const conversationId = await this.ensureConversation(manager, conversation, userContext);

            const userMsg = await manager.save(
                manager.create(AiMessageEntity, {
                    conversationId,
                    role: AiMessageRole.USER,
                    content: message,
                    status: AiMessageStatus.SUCCESS,
                    clientMessageId: clientMessageId ?? null,
                    isEmergency: true,
                    emergencyRuleId: rule?.id ?? null,
                }),
            );

            const assistantMsg = await manager.save(
                manager.create(AiMessageEntity, {
                    conversationId,
                    role: AiMessageRole.ASSISTANT,
                    content: emergency.overrideResponse ?? '',
                    status: AiMessageStatus.SUCCESS,
                    parentMessageId: userMsg.id,
                    isEmergency: true,
                    emergencyRuleId: rule?.id ?? null,
                }),
            );

            await this.saveOutbox(manager, 'AI_EMERGENCY', 'AI_EMERGENCY_DETECTED', {
                conversationId,
                messageId: assistantMsg.id,
                patientMessageId: userMsg.id,
                patientId: userContext.userId || null,
                deviceId: userContext.deviceId || null,
                ruleId: rule?.id,
                category: rule?.category,
                rulesVersion: emergency.rulesVersion,
                detectedAt: new Date(),
            });

            return { conversationId, messageId: assistantMsg.id, isEmergency: true, replayed: false };
        });
    }

    private async ensureConversation(
        manager: EntityManager,
        existing: AiConversationEntity | null,
        userContext: UserContext,
    ): Promise<string> {
        if (existing) {
            await manager.update(AiConversationEntity, existing.id, { updatedAt: new Date() });
            return existing.id;
        }

        const saved = await manager.save(
            manager.create(AiConversationEntity, {
                patientId: userContext.userId || null,
                deviceId: userContext.deviceId || null,
            }),
        );

        await this.saveOutbox(manager, 'AI_CONVERSATION', 'AI_CONVERSATION_STARTED', {
            conversationId: saved.id,
            patientId: userContext.userId || null,
            deviceId: userContext.deviceId || null,
            createdAt: new Date(),
        });

        return saved.id;
    }

    private async saveOutbox(
        manager: EntityManager,
        aggregateType: string,
        eventType: string,
        payload: Record<string, unknown>,
    ): Promise<void> {
        await manager.save(
            manager.create(OutboxEventEntity, {
                aggregateType,
                eventType,
                exchange: 'ai_exchange',
                payload,
                status: OutboxEventStatus.PENDING,
            }),
        );
    }



    private async findOwnedConversation(
        conversationId: string,
        ctx: UserContext,
    ): Promise<AiConversationEntity | null> {
        const repo = this.dataSource.getRepository(AiConversationEntity);

        if (ctx.userId) {
            return repo.findOne({ where: { id: conversationId, patientId: ctx.userId } });
        }
        if (!ctx.deviceId) return null;

        return repo.findOne({
            where: { id: conversationId, patientId: IsNull(), deviceId: ctx.deviceId },
        });
    }

    private async findReplay(
        clientMessageId: string,
        ctx: UserContext,
    ): Promise<Omit<StartedMessage, 'replayed'> | null> {
        const repo = this.dataSource.getRepository(AiMessageEntity);

        const qb = repo
            .createQueryBuilder('m')
            .innerJoin('m.conversation', 'c')
            .where('m.clientMessageId = :clientMessageId', { clientMessageId })
            .andWhere('m.role = :role', { role: AiMessageRole.USER });

        if (ctx.userId) {
            qb.andWhere('c.patientId = :uid', { uid: ctx.userId });
        } else {
            qb.andWhere('c.patientId IS NULL').andWhere('c.deviceId = :did', { did: ctx.deviceId });
        }

        const userMsg = await qb.getOne();
        if (!userMsg) return null;

        const assistant = await repo.findOne({ where: { parentMessageId: userMsg.id } });
        if (!assistant) return null;

        return {
            conversationId: userMsg.conversationId,
            messageId: assistant.id,
            isEmergency: assistant.isEmergency,
        };
    }

    private async assertNotBusy(conversationId: string): Promise<void> {
        const active = await this.dataSource.getRepository(AiMessageEntity).count({
            where: {
                conversationId,
                status: AiMessageStatus.STREAMING,
                updatedAt: MoreThan(new Date(Date.now() - STALE_STREAM_MS)),
            },
            take: 1,
        });

        if (active > 0) {
            throw new ConflictException({
                code: 'CONVERSATION_BUSY',
                messageKey: 'errors.ai.conversation_busy',
                message: 'Another message is still being answered in this conversation.',
            });
        }
    }

    private async failStaleStreaming(manager: EntityManager, conversationId: string): Promise<void> {
        const stale = await manager.find(AiMessageEntity, {
            where: {
                conversationId,
                status: AiMessageStatus.STREAMING,
                updatedAt: LessThan(new Date(Date.now() - STALE_STREAM_MS)),
            },
        });

        for (const msg of stale) {
            const partial = this.stripSpecialtyTag(msg.content).trim();
            await manager.update(AiMessageEntity, msg.id, {
                content: partial,
                status: partial ? AiMessageStatus.PARTIAL : AiMessageStatus.FAILED,
                errorCode: 'GENERATION_INTERRUPTED',
            });
        }
    }

    private async getBoundedHistory(conversationId: string, excludeIds: string[]): Promise<ChatMessage[]> {
        const rows = await this.dataSource.getRepository(AiMessageEntity).find({
            where: {
                conversationId,
                id: Not(In(excludeIds)),
                status: In([AiMessageStatus.SUCCESS, AiMessageStatus.PARTIAL]),
            },
            order: { createdAt: 'DESC', role: 'DESC' },
            take: HISTORY_MAX_MESSAGES,
        });

        const chronological = rows.reverse();

        let total = 0;
        const kept: AiMessageEntity[] = [];
        for (let i = chronological.length - 1; i >= 0; i--) {
            total += chronological[i].content.length;
            if (total > HISTORY_MAX_CHARS) break;
            kept.unshift(chronological[i]);
        }
        while (kept.length && kept[0].role !== AiMessageRole.USER) kept.shift();

        return kept.map((m) => ({
            role: m.role === AiMessageRole.USER ? ('user' as const) : ('assistant' as const),
            content: m.content,
        }));
    }


    private isUniqueViolation(err: any, constraint: string): boolean {
        const code = err?.code ?? err?.driverError?.code;
        const name = err?.constraint ?? err?.driverError?.constraint;
        return code === '23505' && name === constraint;
    }

    private stripSpecialtyTag(text: string): string {
        return text.replace(/<SPECIALTY>[\s\S]*$/, '');
    }


    private sanitizeInputText(input: string): string {
        if (!input) return input;

        let sanitized = input.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CARD]');

        sanitized = sanitized.replace(/(password|bearer|token|secret)\s*[:=]\s*[^\s]+/gi, '$1: [REDACTED]');

        return sanitized;
    }
}