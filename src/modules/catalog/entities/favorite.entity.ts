import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
    Unique,
} from 'typeorm';
import { DoctorEntity } from '../../catalog/entities/doctor.entity';

@Entity('user_favorites')
@Unique(['userId', 'doctorId'])
export class FavoriteEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ type: 'uuid' })
    userId: string;

    @Index()
    @Column({ type: 'uuid' })
    doctorId: string;

    @ManyToOne(() => DoctorEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'doctorId' })
    doctor: DoctorEntity;

    @CreateDateColumn()
    createdAt: Date;
}