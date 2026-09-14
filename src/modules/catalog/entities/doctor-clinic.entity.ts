import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { DoctorEntity } from './doctor.entity';
import { ClinicEntity } from './clinic.entity';

@Entity('doctor_clinics')
@Index(['doctorId', 'clinicId'], { unique: true })
@Index(['isActive', 'consultationFee'])
export class DoctorClinicEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid' })
    doctorId: string;

    @Column({ type: 'uuid' })
    clinicId: string;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    consultationFee: number;

    @Column({ type: 'jsonb', nullable: true })
    schedule: Record<string, any>;

    @Column({ default: true })
    isActive: boolean;

    @ManyToOne(() => DoctorEntity, (doctor) => doctor.doctorClinics, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'doctorId' })
    doctor: DoctorEntity;

    @ManyToOne(() => ClinicEntity, (clinic) => clinic.doctorClinics, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'clinicId' })
    clinic: ClinicEntity;
}