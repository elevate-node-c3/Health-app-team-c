import { Repository, SelectQueryBuilder } from 'typeorm';
import { DoctorEntity } from '../entities/doctor.entity';

export function createBaseDoctorQuery(doctorRepo: Repository<DoctorEntity>): SelectQueryBuilder<DoctorEntity> {
  return doctorRepo
    .createQueryBuilder('doctor')
    .innerJoin('doctor.doctorClinics', 'dc', 'dc.isActive = :isActive', { isActive: true })
    .innerJoin('dc.clinic', 'clinic')
    .leftJoin('doctor.specialty', 'specialty')
    .select([
      'doctor.id AS id',
      'doctor.fullName AS fullName',
      'doctor.title AS title',
      'doctor.gender AS gender',
      'specialty.name AS specialtyName',
      'COALESCE(MIN(dc.consultationFee), 0) AS consultationFee',
      'doctor.averageRating AS averageRating',
      'doctor.photoUrl AS photoUrl',
    ])
    .where('doctor.isVerified = :verified', { verified: true })
    .andWhere('doctor.isActive = :active', { active: true })
    .groupBy('doctor.id, specialty.id');
}
