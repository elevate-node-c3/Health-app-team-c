import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { DoctorEntity } from './doctor.entity';
import { ClinicEntity } from './clinic.entity';

export enum AppointmentStatus {
    BOOKED = 'BOOKED',
    CANCELLED = 'CANCELLED',
    COMPLETED = 'COMPLETED',
}

@Entity('appointments')
export class AppointmentEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid' })
    doctorId: string;

    @Column({ type: 'uuid' })
    clinicId: string;

    @Column({ type: 'uuid', nullable: true })
    patientId: string;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ type: 'time' })
    startTime: string; // HH:mm:ss

    @Column({ type: 'time' })
    endTime: string; // HH:mm:ss

    @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.BOOKED })
    status: AppointmentStatus;

    @Column({ nullable: true })
    snapshotSpecialtyName: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    snapshotConsultationFee: number;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => DoctorEntity, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'doctorId' })
    doctor: DoctorEntity;

    @ManyToOne(() => ClinicEntity, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'clinicId' })
    clinic: ClinicEntity;
}
