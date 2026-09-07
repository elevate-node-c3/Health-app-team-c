import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('outbox_events')
export class OutboxEventEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    aggregateType: string;

    @Column({ type: 'varchar', length: 100 })
    eventType: string;

    @Column({ type: 'jsonb' })
    payload: any;

    @Column({ default: false })
    isProcessed: boolean;

    @CreateDateColumn()
    createdAt: Date;
}