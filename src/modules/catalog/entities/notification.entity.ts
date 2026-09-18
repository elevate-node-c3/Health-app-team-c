import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { DoctorEntity } from './doctor.entity';

@Entity('notifications')
export class NotificationEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ type: 'uuid' })
    userId: string;

    @Index()
    @Column({ type: 'uuid' })
    doctorId: string;

    @Column({ length: 50 })
    type: string;

    @Column()
    title: string;

    @Column()
    message: string;

    @Column({ default: false })
    isRead: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => DoctorEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'doctorId' })
    doctor: DoctorEntity;
}
