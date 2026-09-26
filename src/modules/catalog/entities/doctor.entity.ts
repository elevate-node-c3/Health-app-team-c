import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { SpecialtyEntity } from './specialty.entity';
import { DoctorClinicEntity } from './doctor-clinic.entity';


export enum DoctorTitle {
    PROFESSOR = 'Professor',
    CONSULTANT = 'Consultant',
    SPECIALIST = 'Specialist',
}

export enum DoctorGender {
    MALE = 'Male',
    FEMALE = 'Female',
}

@Index(['isActive', 'isVerified', 'averageRating'])
@Index(['isVerified', 'averageRating'])
@Entity('doctors')
export class DoctorEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    fullName: string;

    @Column({
        type: 'enum',
        enum: DoctorTitle,
        default: DoctorTitle.SPECIALIST,
    })
    title: DoctorTitle;

    @Column({ nullable: true })
    photoUrl: string;

    @Column({ type: 'int', default: 0 })
    experienceYears: number;

    @Column({ nullable: true })
    university: string;

    @Column('simple-array', { nullable: true })
    subspecialties: string[];

    @Column({ type: 'decimal', precision: 3, scale: 2, default: 0.0 })
    averageRating: number;

    @Column({ type: 'int', default: 0 })
    totalReviews: number;

    @Column({ type: 'int', default: 0 })
    totalPatients: number;

    @Column({ default: false })
    isVerified: boolean;

    @Index()
    @Column({ type: 'enum', enum: DoctorGender, nullable: true })
    gender: DoctorGender;
    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'uuid' })
    specialtyId: string;

    @ManyToOne(() => SpecialtyEntity, (specialty) => specialty.doctors, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'specialtyId' })
    specialty: SpecialtyEntity;

    @OneToMany(() => DoctorClinicEntity, (doctorClinic) => doctorClinic.doctor, { cascade: true })
    doctorClinics: DoctorClinicEntity[];
}