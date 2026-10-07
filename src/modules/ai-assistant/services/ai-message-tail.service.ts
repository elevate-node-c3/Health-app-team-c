import { Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Observable } from 'rxjs';
import { AiMessageEntity } from '../entities/ai-message.entity';
import { AiMessageRole } from '../enums/ai-message-role.enum';
import { AiMessageStatus } from '../enums/ai-message-status.enum';
import { AI_ERROR_PUBLIC, AiErrorCode } from '../errors/ai-provider.error';
import { UserContext } from 'src/common/middleware/auth-context.middleware';

export interface AiMessageSnapshot {
    messageId: string;
    conversationId: string;
    status: AiMessageStatus;
    text: string;
    specialtySuggestion: AiMessageEntity['specialtySuggestion'];
    isEmergency: boolean;
    error: { code: string; messageKey: string; message: string } | null;
}

export interface StartInfo {
    conversationId: string;
    replayed: boolean;
}

const POLL_INTERVAL_MS = 400;
const PING_INTERVAL_MS = 15_000;
const MAX_TAIL_MS = 120_000;
const STALE_STREAM_MS = 45_000;


@Injectable()
export class AiMessageTailService {
    constructor(private readonly dataSource: DataSource) { }

    async getSnapshot(messageId: string, ctx: UserContext): Promise<AiMessageSnapshot> {
        const msg = await this.findOwnedAssistantMessage(messageId, ctx);
        return this.toSnapshot(await this.failIfStale(msg));
    }


    async openTail(
        messageId: string,
        ctx: UserContext,
        offset = 0,
        start?: StartInfo,
    ): Promise<Observable<MessageEvent>> {
        const first = await this.findOwnedAssistantMessage(messageId, ctx);
        const conversationId = first.conversationId;

        return new Observable<MessageEvent>((sub) => {
            let sent = Math.max(0, Math.floor(offset) || 0);
            let closed = false;
            let pollTimer: NodeJS.Timeout | undefined;
            const startedAt = Date.now();

            if (start) {
                sub.next({
                    type: 'start',
                    data: { conversationId, messageId, replayed: start.replayed },
                });
            }

            const pingTimer = setInterval(() => sub.next({ type: 'ping', data: {} }), PING_INTERVAL_MS);

            const finish = () => {
                closed = true;
                clearInterval(pingTimer);
                if (pollTimer) clearTimeout(pollTimer);
                sub.complete();
            };

            const poll = async () => {
                if (closed) return;
                try {
                    const row = await this.dataSource.getRepository(AiMessageEntity).findOne({ where: { id: messageId } });
                    if (!row) {
                        sub.next({ type: 'error', data: this.publicError('PROVIDER_ERROR', '') });
                        return finish();
                    }

                    const msg = await this.failIfStale(row);

                    if (msg.content.length > sent) {
                        const text = msg.content.slice(sent);
                        sent = msg.content.length;
                        sub.next({ id: String(sent), type: 'chunk', data: { text } });
                    }

                    if (msg.status === AiMessageStatus.STREAMING) {
                        if (Date.now() - startedAt > MAX_TAIL_MS) return finish();
                        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
                        return;
                    }

                    if (msg.status === AiMessageStatus.SUCCESS) {

                        sub.next({
                            type: 'done',
                            data: {
                                messageId,
                                conversationId,
                                text: msg.content,
                                specialtySuggestion: msg.specialtySuggestion,
                                isEmergency: msg.isEmergency,
                            },
                        });
                    } else {
                        sub.next({
                            type: 'error',
                            data: this.publicError((msg.errorCode as AiErrorCode) ?? 'PROVIDER_ERROR', msg.content),
                        });
                    }
                    finish();
                } catch {
                    if (!closed) pollTimer = setTimeout(poll, POLL_INTERVAL_MS * 4);
                }
            };

            void poll();

            return () => {
                closed = true;
                clearInterval(pingTimer);
                if (pollTimer) clearTimeout(pollTimer);
            };
        });
    }


    private async findOwnedAssistantMessage(messageId: string, ctx: UserContext): Promise<AiMessageEntity> {
        const qb = this.dataSource
            .getRepository(AiMessageEntity)
            .createQueryBuilder('m')
            .innerJoin('m.conversation', 'c')
            .where('m.id = :messageId', { messageId })
            .andWhere('m.role = :role', { role: AiMessageRole.ASSISTANT });

        if (ctx.userId) {
            qb.andWhere('c.patientId = :uid', { uid: ctx.userId });
        } else if (ctx.deviceId) {
            qb.andWhere('c.patientId IS NULL').andWhere('c.deviceId = :did', { did: ctx.deviceId });
        } else {
            throw new NotFoundException({ code: 'AI_MESSAGE_NOT_FOUND' });
        }

        const msg = await qb.getOne();
        if (!msg) throw new NotFoundException({ code: 'AI_MESSAGE_NOT_FOUND' });
        return msg;
    }

    private async failIfStale(msg: AiMessageEntity): Promise<AiMessageEntity> {
        if (msg.status !== AiMessageStatus.STREAMING) return msg;
        if (Date.now() - msg.updatedAt.getTime() < STALE_STREAM_MS) return msg;

        const partial = msg.content.replace(/<SPECIALTY>[\s\S]*$/, '').trim();
        const status = partial ? AiMessageStatus.PARTIAL : AiMessageStatus.FAILED;

        await this.dataSource.getRepository(AiMessageEntity).update(
            { id: msg.id, status: AiMessageStatus.STREAMING },
            { content: partial, status, errorCode: 'GENERATION_INTERRUPTED' },
        );

        const fresh = await this.dataSource.getRepository(AiMessageEntity).findOne({ where: { id: msg.id } });
        return fresh ?? msg;
    }

    private toSnapshot(msg: AiMessageEntity): AiMessageSnapshot {
        const failed = msg.status === AiMessageStatus.FAILED || msg.status === AiMessageStatus.PARTIAL;
        return {
            messageId: msg.id,
            conversationId: msg.conversationId,
            status: msg.status,
            text: msg.content,
            specialtySuggestion: msg.specialtySuggestion,
            isEmergency: msg.isEmergency,
            error: failed ? this.snapshotError((msg.errorCode as AiErrorCode) ?? 'PROVIDER_ERROR') : null,
        };
    }

    private snapshotError(code: AiErrorCode) {
        const pub = AI_ERROR_PUBLIC[code] ?? AI_ERROR_PUBLIC.PROVIDER_ERROR;
        return { code, ...pub };
    }

    private publicError(code: AiErrorCode, partialText: string) {
        const pub = AI_ERROR_PUBLIC[code] ?? AI_ERROR_PUBLIC.PROVIDER_ERROR;
        return { code, ...pub, partialText };
    }
}