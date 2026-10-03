// import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
// import { DoctorEntity } from './doctor.entity';
// import { ClinicEntity } from './clinic.entity';

// export enum AppointmentStatus {
//     BOOKED = 'BOOKED',
//     CANCELLED = 'CANCELLED',
//     COMPLETED = 'COMPLETED',
// }

// @Entity('appointments')
// export class AppointmentEntity {
//     @PrimaryGeneratedColumn('uuid')
//     id: string;

//     @Column({ type: 'uuid' })
//     doctorId: string;

//     @Column({ type: 'uuid' })
//     clinicId: string;

//     @Column({ type: 'uuid', nullable: true })
//     patientId: string;

//     @Column({ type: 'date' })
//     date: string; // YYYY-MM-DD

//     @Column({ type: 'time' })
//     startTime: string; // HH:mm:ss

//     @Column({ type: 'time' })
//     endTime: string; // HH:mm:ss

//     @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.BOOKED })
//     status: AppointmentStatus;

//     @Column({ nullable: true })
//     snapshotSpecialtyName: string;

//     @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
//     snapshotConsultationFee: number;

//     @CreateDateColumn()
//     createdAt: Date;

//     @ManyToOne(() => DoctorEntity, { onDelete: 'RESTRICT' })
//     @JoinColumn({ name: 'doctorId' })
//     doctor: DoctorEntity;

//     @ManyToOne(() => ClinicEntity, { onDelete: 'RESTRICT' })
//     @JoinColumn({ name: 'clinicId' })
//     clinic: ClinicEntity;
// }

import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';
import { DoctorEntity } from './doctor.entity';
import { ClinicEntity } from './clinic.entity';

export enum AppointmentStatus {
    BOOKED = 'BOOKED',
    CANCELLED = 'CANCELLED',
    COMPLETED = 'COMPLETED',
    NO_SHOW = 'NO_SHOW',
}

export enum CancellationOutcome {
    FREE = 'FREE',
    NO_REFUND = 'NO_REFUND',
}

@Entity('appointments')
@Index(['patientId', 'date', 'startTime'])
@Index(['doctorId', 'clinicId', 'date', 'startTime'], {
    unique: true,
    where: `"status" = 'BOOKED'`,
})
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
    date: string;

    @Column({ type: 'time' })
    startTime: string;

    @Column({ type: 'time' })
    endTime: string;

    @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.BOOKED })
    status: AppointmentStatus;

    @Column({ nullable: true })
    snapshotSpecialtyName: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    snapshotConsultationFee: number;

    @Index({ unique: true })
    @Column({ type: 'uuid', nullable: true })
    holdId: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    cancelledAt: Date | null;

    @Column({ type: 'enum', enum: CancellationOutcome, nullable: true })
    cancellationOutcome: CancellationOutcome | null;

    @Column({ type: 'timestamptz', nullable: true })
    completedAt: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    noShowAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => DoctorEntity, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'doctorId' })
    doctor: DoctorEntity;

    @ManyToOne(() => ClinicEntity, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'clinicId' })
    clinic: ClinicEntity;
}