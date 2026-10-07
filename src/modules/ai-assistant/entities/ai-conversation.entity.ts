import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany,
    Index,
} from 'typeorm';
import { AiMessageEntity } from './ai-message.entity';

@Entity('ai_conversations')
@Index(['patientId'])
@Index(['deviceId'])
export class AiConversationEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid', nullable: true })
    patientId: string | null;

    @Column({ type: 'varchar', nullable: true })
    deviceId: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToMany(() => AiMessageEntity, (message) => message.conversation, {
        cascade: true,
    })
    messages: AiMessageEntity[];
}