import {
    Body,
    Controller,
    Delete,
    Get,
    Header,
    Headers,
    HttpCode,
    HttpStatus,
    MessageEvent,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SendMessageDto } from './dto/send-message.dto';
import { AiAssistantService } from './ai-assistent.service';
import { DeleteAiConversationUseCase } from './use-cases/delete-ai-conversation.use-case';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { CurrentUserContext } from './decorators/current-use-context.decorator';



@Controller('ai-assistant')
export class AiAssistantController {
    constructor(
        private readonly aiAssistantService: AiAssistantService,
        private readonly deleteConversationUseCase: DeleteAiConversationUseCase,
    ) { }

    @Post('chat')
    @Header('X-Accel-Buffering', 'no')
    @Sse()
    async chat(
        @Body() dto: SendMessageDto,
        @CurrentUserContext() userContext: UserContext,
    ): Promise<Observable<MessageEvent>> {
        const started = await this.aiAssistantService.startMessage(dto, userContext);
        return this.aiAssistantService.openStream(started.messageId, userContext, 0, started);
    }


    @Sse('messages/:id/stream')
    @Header('X-Accel-Buffering', 'no')
    async streamMessage(
        @Param('id', ParseUUIDPipe) id: string,
        @Query('offset') offsetQuery: string | undefined,
        @Headers('last-event-id') lastEventId: string | undefined,
        @CurrentUserContext() userContext: UserContext,
    ): Promise<Observable<MessageEvent>> {
        const raw = lastEventId ?? offsetQuery ?? '0';
        const offset = Number.parseInt(raw, 10);
        return this.aiAssistantService.openStream(
            id,
            userContext,
            Number.isFinite(offset) && offset > 0 ? offset : 0,
        );
    }

    @Get('messages/:id')
    getMessage(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUserContext() userContext: UserContext,
    ) {
        return this.aiAssistantService.getMessage(id, userContext);
    }


    @Delete('conversations/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteConversation(
        @Param('id', ParseUUIDPipe) conversationId: string,
        @CurrentUserContext() userContext: UserContext,
    ): Promise<void> {
        await this.deleteConversationUseCase.execute(conversationId, userContext);
    }
}