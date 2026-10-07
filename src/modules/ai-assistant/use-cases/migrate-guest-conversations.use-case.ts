import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AiConversationEntity } from '../entities/ai-conversation.entity';

@Injectable()
export class MigrateGuestConversationsUseCase {
    private readonly logger = new Logger(MigrateGuestConversationsUseCase.name);

    constructor(
        @InjectRepository(AiConversationEntity)
        private readonly conversationRepo: Repository<AiConversationEntity>,
    ) { }

    async execute(deviceId: string, userId: string): Promise<number> {
        if (!deviceId || !userId) {
            return 0;
        }

        const result = await this.conversationRepo.update(
            {
                deviceId,
                patientId: IsNull(),
            },
            {
                patientId: userId,
            },
        );

        const affectedCount = result.affected || 0;
        this.logger.log(
            `Successfully migrated ${affectedCount} guest conversations to user ${userId}`,
        );

        return affectedCount;
    }
}