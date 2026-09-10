import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('processed_events')
export class ProcessedEventEntity {
    @PrimaryColumn()
    eventId: string;

    @Column()
    eventType: string;

    @CreateDateColumn()
    processedAt: Date;
}