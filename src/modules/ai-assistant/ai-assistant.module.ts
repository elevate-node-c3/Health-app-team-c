import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConversationEntity } from './entities/ai-conversation.entity';
import { AiMessageEntity } from './entities/ai-message.entity';
import { AiAssistantController } from './ai-assistant.controller';
import { AiProviderService } from './services/ai-provider.service';
import { SendAiMessageUseCase } from './use-cases/send-ai-message.use-case';
import { AiRateLimitGuard } from './guards/ai-rate-limit.guard';
import { AiAssistantService } from './ai-assistent.service';
import { MigrateGuestConversationsUseCase } from './use-cases/migrate-guest-conversations.use-case';
import { AiEventsConsumer } from './consumers/ai-events.consumer';
import { OutboxModule } from 'src/common/outbox/outbox.module';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { EmergencyDetectorService } from './services/emergency-detector.service';
import { DoctorClinicEntity } from '../catalog/entities/doctor-clinic.entity';
import { DoctorEntity } from '../catalog/entities/doctor.entity';
import { AppointmentEntity } from '../catalog/entities/appointment.entity';
import { CapabilityExecutorService } from './services/capability-executor.service';
import { AiCapabilitiesService } from './capabilities/ai-capabilities.service';
import { AiMessageTailService } from './services/ai-message-tail.service';
import { AiQuotaService } from './services/ai-quota.service';
import { CATALOG_GATEWAY, FREE_SLOTS_PROVIDER } from './capabilities/catalog.gateway';
import { TypeOrmCatalogGateway } from './capabilities/typeorm-catalog.gateway';
import { CatalogFreeSlotsProvider } from './capabilities/catalog-free-slots.provider';
import { CatalogModule } from '../catalog/catalog.module';
import { DeleteAiConversationUseCase } from './use-cases/delete-ai-conversation.use-case';
import { PurgeAiRetentionUseCase } from './use-cases/purge-ai-retention.use-case';
import { AiRetentionCron } from './jobs/ai-retention.cron';



@Module({
    imports: [
        TypeOrmModule.forFeature([
            AiConversationEntity,
            AiMessageEntity,
            ProcessedEventEntity,
            DoctorClinicEntity,
            DoctorEntity,
            AppointmentEntity,
        ]),
        OutboxModule,
        CatalogModule
    ],
    controllers: [
        AiAssistantController,
    ],
    providers: [
        AiAssistantService,
        AiProviderService,
        SendAiMessageUseCase,
        MigrateGuestConversationsUseCase,
        AiEventsConsumer,
        EmergencyDetectorService,
        CapabilityExecutorService,
        AiCapabilitiesService,
        AiQuotaService,
        AiMessageTailService,
        { provide: CATALOG_GATEWAY, useClass: TypeOrmCatalogGateway },
        CatalogFreeSlotsProvider,
        { provide: FREE_SLOTS_PROVIDER, useExisting: CatalogFreeSlotsProvider },
        PurgeAiRetentionUseCase,
        DeleteAiConversationUseCase,
        AiRetentionCron
    ],
    exports: [
        AiAssistantService,
        SendAiMessageUseCase,
        MigrateGuestConversationsUseCase,
    ],
})
export class AiAssistantModule { }