import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index } from 'typeorm';
import { DoctorClinicEntity } from './doctor-clinic.entity';

export enum PlaceType {
    CLINIC = 'clinic',
    CENTRE = 'centre',
    HOSPITAL = 'hospital',
}

@Index(['placeType', 'governorate', 'city'])
@Index(['latitude', 'longitude'])
@Entity('clinics')
export class ClinicEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({
        type: 'enum',
        enum: PlaceType,
        default: PlaceType.CLINIC,
    })
    placeType: PlaceType;

    @Column()
    governorate: string;

    @Column()
    city: string;

    @Column()
    address: string;

    @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
    latitude: number;

    @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
    longitude: number;

    @Column({ default: true })
    isActive: boolean;

    @OneToMany(() => DoctorClinicEntity, (doctorClinic) => doctorClinic.clinic)
    doctorClinics: DoctorClinicEntity[];
}