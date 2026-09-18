import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClinicEntity } from '../entities/clinic.entity';
import { SearchMapDto } from '../dto/search-map.dto';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

@Injectable()
export class SearchMapUseCase {
    constructor(
        @InjectRepository(ClinicEntity)
        private readonly clinicRepo: Repository<ClinicEntity>,
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepo: Repository<OutboxEventEntity>,
    ) { }

    async execute(dto: SearchMapDto, userId?: string) {
        const { north, south, east, west, latitude, longitude, specialtyId, doctorName } = dto;

        const qb = this.clinicRepo.createQueryBuilder('clinic')
            .innerJoin('clinic.doctorClinics', 'dc', 'dc.isActive = :isActive', { isActive: true })
            .innerJoin('dc.doctor', 'doctor', 'doctor.isVerified = :isVerified', { isVerified: true })
            .leftJoin('doctor.specialty', 'specialty')
            .where('clinic.latitude IS NOT NULL')
            .andWhere('clinic.longitude IS NOT NULL')
            .andWhere('clinic.latitude <= :north', { north })
            .andWhere('clinic.latitude >= :south', { south })
            .andWhere('clinic.longitude <= :east', { east })
            .andWhere('clinic.longitude >= :west', { west });

        if (specialtyId) {
            qb.andWhere('doctor.specialtyId = :specialtyId', { specialtyId });
        }

        if (doctorName) {
            qb.andWhere('doctor.fullName ILIKE :doctorName', { doctorName: `%${doctorName}%` });
        }

        qb.select([
            'clinic.id AS "clinicId"',
            'clinic.name AS "clinicName"',
            'clinic.latitude AS "latitude"',
            'clinic.longitude AS "longitude"',
            'doctor.id AS "doctorId"',
            'doctor.fullName AS "doctorName"',
            'specialty.name AS "specialtyName"',
            'dc.consultationFee AS "consultationFee"',
            'doctor.averageRating AS "averageRating"',
            'doctor.photoUrl AS "photoUrl"'
        ]);

        if (latitude !== undefined && longitude !== undefined) {
            // Haversine formula for distance in km
            qb.addSelect(
                `(6371 * acos(cos(radians(:lat)) * cos(radians(clinic.latitude)) * cos(radians(clinic.longitude) - radians(:lng)) + sin(radians(:lat)) * sin(radians(clinic.latitude))))`,
                'distanceKm'
            )
            .setParameters({ lat: latitude, lng: longitude })
            .orderBy('"distanceKm"', 'ASC');
        } else {
            qb.addSelect('NULL', 'distanceKm');
            qb.orderBy('doctor.averageRating', 'DESC');
        }

        // Cap at 500
        const take = 500;
        qb.limit(take + 1);

        const rawResults = await qb.getRawMany();

        const hasMore = rawResults.length > take;
        const items = rawResults.slice(0, take).map(row => ({
            clinicId: row.clinicId,
            clinicName: row.clinicName,
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            doctorId: row.doctorId,
            doctorName: row.doctorName,
            specialtyName: row.specialtyName,
            consultationFee: parseFloat(row.consultationFee),
            averageRating: parseFloat(row.averageRating),
            photoUrl: row.photoUrl,
            distanceKm: row.distanceKm !== null ? parseFloat(row.distanceKm) : null
        }));

        // Fire domain event
        await this.outboxRepo.save({
            aggregateType: 'ANALYTICS',
            eventType: 'MapRegionSearched',
            payload: {
                userId: userId || null,
                north, south, east, west,
                userLatitude: latitude || null,
                userLongitude: longitude || null,
                specialtyId: specialtyId || null,
                searchedAt: new Date()
            }
        });

        return {
            items,
            hasMore
        };
    }
}
