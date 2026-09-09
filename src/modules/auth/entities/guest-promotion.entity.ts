import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('guest_promotions')
export class GuestPromotionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ name: 'device_id', type: 'varchar', length: 100, unique: true })
    deviceId: string;

    @Index()
    @Column({ name: 'user_id', type: 'varchar' })
    userId: string;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'booking_intent', type: 'jsonb', nullable: true })
    bookingIntent: Record<string, any> | null;

    @CreateDateColumn({ name: 'promoted_at' })
    promotedAt: Date;
}
