// import { Injectable } from '@nestjs/common';
// import { SendAiMessageUseCase, SendMessageCommand } from './use-cases/send-ai-message.use-case';
// import { SendMessageDto } from './dto/send-message.dto';
// import { UserContext } from 'src/common/middleware/auth-context.middleware';
// import { MigrateGuestConversationsUseCase } from './use-cases/migrate-guest-conversations.use-case';

// @Injectable()
// export class AiAssistantService {
//     constructor(
//         private readonly sendAiMessageUseCase: SendAiMessageUseCase,
//         private readonly migrateGuestConversationsUseCase: MigrateGuestConversationsUseCase,
//     ) { }

//     async sendMessage(params: {
//         dto: SendMessageDto;
//         userContext: UserContext;
//         signal?: AbortSignal;
//         onStart: (conversationId: string, messageId: string) => void;
//         onChunk: (chunkText: string) => void;
//     }) {
//         const { dto, userContext, signal, onStart, onChunk } = params;

//         const command: SendMessageCommand = {
//             conversationId: dto.conversationId,
//             message: dto.message,
//             clientMessageId: dto.clientMessageId,
//             deviceId: dto.deviceId,
//             userContext,
//             signal,
//             onStart,
//             onChunk,
//         };

//         return this.sendAiMessageUseCase.execute(command);
//     }

//     async migrateGuestConversations(deviceId: string, userId: string) {
//         return this.migrateGuestConversationsUseCase.execute(deviceId, userId);
//     }
// }





import { Injectable } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SendAiMessageUseCase, StartedMessage } from './use-cases/send-ai-message.use-case';
import { MigrateGuestConversationsUseCase } from './use-cases/migrate-guest-conversations.use-case';
import { AiMessageSnapshot, AiMessageTailService } from './services/ai-message-tail.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UserContext } from 'src/common/middleware/auth-context.middleware';

@Injectable()
export class AiAssistantService {
    constructor(
        private readonly sendAiMessageUseCase: SendAiMessageUseCase,
        private readonly migrateGuestConversationsUseCase: MigrateGuestConversationsUseCase,
        private readonly tailService: AiMessageTailService,
    ) { }

    startMessage(dto: SendMessageDto, userContext: UserContext): Promise<StartedMessage> {
        return this.sendAiMessageUseCase.start({
            conversationId: dto.conversationId,
            message: dto.message,
            clientMessageId: dto.clientMessageId,
            userContext,
        });
    }

    openStream(
        messageId: string,
        userContext: UserContext,
        offset = 0,
        started?: StartedMessage,
    ): Promise<Observable<MessageEvent>> {
        return this.tailService.openTail(
            messageId,
            userContext,
            offset,
            started ? { conversationId: started.conversationId, replayed: started.replayed } : undefined,
        );
    }

    getMessage(messageId: string, userContext: UserContext): Promise<AiMessageSnapshot> {
        return this.tailService.getSnapshot(messageId, userContext);
    }

    migrateGuestConversations(deviceId: string, userId: string) {
        return this.migrateGuestConversationsUseCase.execute(deviceId, userId);
    }
}