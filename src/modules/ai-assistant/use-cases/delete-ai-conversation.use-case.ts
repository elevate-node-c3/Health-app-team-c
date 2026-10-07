import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AiConversationEntity } from '../entities/ai-conversation.entity';
import { AiMessageEntity } from '../entities/ai-message.entity';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { OutboxEventEntity, OutboxEventStatus } from 'src/common/outbox/entities/outbox-event.entity';

@Injectable()
export class DeleteAiConversationUseCase {
    private readonly logger = new Logger(DeleteAiConversationUseCase.name);

    constructor(private readonly dataSource: DataSource) { }

    async execute(conversationId: string, userContext: UserContext): Promise<void> {
        if (!userContext?.userId && !userContext?.deviceId) {
            throw new ForbiddenException({ code: 'AUTH_IDENTITY_MISSING' });
        }

        const convRepo = this.dataSource.getRepository(AiConversationEntity);

        const conversation = await convRepo.findOne({
            where: userContext.userId
                ? { id: conversationId, patientId: userContext.userId }
                : { id: conversationId, patientId: IsNull(), deviceId: userContext.deviceId },
        });

        if (!conversation) {
            throw new NotFoundException({ code: 'AI_CONVERSATION_NOT_FOUND' });
        }

        await this.dataSource.transaction(async (manager) => {
            await manager.delete(AiMessageEntity, { conversationId });

            await manager.delete(AiConversationEntity, { id: conversationId });

            await manager.save(
                manager.create(OutboxEventEntity, {
                    aggregateType: 'AI_CONVERSATION',
                    eventType: 'AI_CONVERSATION_DELETED',
                    exchange: 'ai_exchange',
                    payload: {
                        conversationId,
                        patientId: userContext.userId || null,
                        deviceId: userContext.deviceId || null,
                        deletedAt: new Date().toISOString(),
                    },
                    status: OutboxEventStatus.PENDING,
                }),
            );
        });

        this.logger.log(`Permanently deleted conversation ${conversationId}`);
    }
}