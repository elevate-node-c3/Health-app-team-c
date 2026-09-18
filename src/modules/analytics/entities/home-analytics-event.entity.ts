import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('home_analytics_events')
export class HomeAnalyticsEventEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: true })
    userId: string;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    openedAt: Date;

    @Column({ nullable: true })
    ipAddress: string;
}