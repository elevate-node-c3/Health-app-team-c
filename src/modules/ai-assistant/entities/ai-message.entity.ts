import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { AiConversationEntity } from './ai-conversation.entity';
import { AiMessageRole } from '../enums/ai-message-role.enum';
import { AiMessageStatus } from '../enums/ai-message-status.enum';
import { SpecialtySuggestion } from '../interfaces/specialty-suggestion.interface';

export const UQ_ONE_STREAMING_PER_CONVERSATION = 'uq_ai_messages_one_streaming';
export const UQ_CLIENT_MESSAGE_ID = 'uq_ai_messages_client_msg';

@Entity('ai_messages')
@Index('idx_ai_messages_conv_created', ['conversationId', 'createdAt'])
@Index('idx_ai_messages_parent', ['parentMessageId'])
@Index(UQ_ONE_STREAMING_PER_CONVERSATION, ['conversationId'], {
    unique: true,
    where: `"status" = 'STREAMING'`,
})
@Index(UQ_CLIENT_MESSAGE_ID, ['conversationId', 'clientMessageId'], {
    unique: true,
    where: `"clientMessageId" IS NOT NULL`,
})
export class AiMessageEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid' })
    conversationId: string;

    @Column({ type: 'enum', enum: AiMessageRole })
    role: AiMessageRole;

    @Column({ type: 'text', default: '' })
    content: string;

    @Column({ type: 'uuid', nullable: true })
    parentMessageId: string | null;

    @Column({ type: 'uuid', nullable: true })
    clientMessageId: string | null;

    @Column({ type: 'jsonb', nullable: true })
    specialtySuggestion: SpecialtySuggestion | null;

    @Column({ type: 'int', default: 0 })
    tokensIn: number;

    @Column({ type: 'int', default: 0 })
    tokensOut: number;

    @Column({ type: 'int', default: 0 })
    durationMs: number;

    @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
    estimatedCostUsd: number;

    @Column({ type: 'varchar', length: 100, nullable: true })
    model: string | null;

    @Column({
        type: 'enum',
        enum: AiMessageStatus,
        default: AiMessageStatus.SUCCESS,
    })
    status: AiMessageStatus;

    @Column({ type: 'varchar', length: 64, nullable: true })
    errorCode: string | null;

    @Column({ type: 'boolean', default: false })
    isEmergency: boolean;

    @Column({ type: 'varchar', length: 64, nullable: true })
    emergencyRuleId: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;

    @ManyToOne(() => AiConversationEntity, (conv) => conv.messages, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'conversationId' })
    conversation: AiConversationEntity;
}