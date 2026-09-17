import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index } from 'typeorm';
import { DoctorEntity } from './doctor.entity';

@Index(['isActive', 'name'])
@Entity('specialties')
export class SpecialtyEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    name: string;

    @Column({ nullable: true })
    description: string;

    @Column({ default: true })
    isActive: boolean;

    @OneToMany(() => DoctorEntity, (doctor) => doctor.specialty)
    doctors: DoctorEntity[];
}