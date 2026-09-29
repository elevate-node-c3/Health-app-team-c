import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { DoctorEntity } from './doctor.entity';

@Entity('reviews')
export class ReviewEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid' })
    doctorId: string;

    @Column()
    patientName: string;

    @Column({ type: 'int' })
    rating: number;

    @Column({ type: 'text', nullable: true })
    comment: string;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => DoctorEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'doctorId' })
    doctor: DoctorEntity;
}
