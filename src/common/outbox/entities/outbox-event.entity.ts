import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum OutboxEventStatus {
    PENDING = 'PENDING',
    PROCESSED = 'PROCESSED',
    FAILED_PERMANENTLY = 'FAILED_PERMANENTLY',
}

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

    @Column({ type: 'varchar', length: 100 })
    exchange: string;

    @Column({ default: false })
    isProcessed: boolean;

    @Column({ type: 'int', default: 0 })
    retryCount: number;

    @Column({
        type: 'enum',
        enum: OutboxEventStatus,
        default: OutboxEventStatus.PENDING,
    })
    status: OutboxEventStatus;

    @Column({ type: 'timestamp', nullable: true })
    lastFailureAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;
}