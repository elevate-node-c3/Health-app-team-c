import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DoctorEntity } from '../entities/doctor.entity';
import { FavoriteEntity } from '../entities/favorite.entity';

@Injectable()
export class ListFavoritesUseCase {
    constructor(
        @InjectRepository(FavoriteEntity)
        private readonly favoriteRepo: Repository<FavoriteEntity>,
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
    ) { }

    async execute(userId: string) {
        const favorites = await this.favoriteRepo.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });

        if (favorites.length === 0) {
            return { message: 'Favorites retrieved successfully', data: [] };
        }

        const doctorIds = favorites.map((f) => f.doctorId);
        const favoritedAtByDoctorId = new Map(favorites.map((f) => [f.doctorId, f.createdAt]));

        const rows = await this.doctorRepo.createQueryBuilder('doctor')
            .leftJoin('doctor.doctorClinics', 'dc', 'dc.isActive = :isActive', { isActive: true })
            .leftJoin('doctor.specialty', 'specialty')
            .select([
                'doctor.id AS id',
                'doctor.fullName AS fullName',
                'specialty.name AS specialtyName',
                'COALESCE(MIN(dc.consultationFee), 0) AS consultationFee',
                'doctor.averageRating AS averageRating',
                'doctor.photoUrl AS photoUrl',
                'doctor.isVerified AS isVerified',
            ])
            .where('doctor.id IN (:...doctorIds)', { doctorIds })
            .groupBy('doctor.id, specialty.id')
            .getRawMany();

        const byId = new Map(rows.map((r) => [r.id, r]));

        const data = favorites.map((fav) => {
            const doc = byId.get(fav.doctorId);
            if (!doc) {
                return {
                    doctorId: fav.doctorId,
                    isFavorite: true,
                    isDeactivated: true,
                    favoritedAt: fav.createdAt,
                };
            }
            const isVerified = doc.isVerified ?? doc.isverified ?? false;
            return {
                doctorId: fav.doctorId,
                name: doc.fullName || doc.fullname,
                specialty: doc.specialtyName || doc.specialtyname || 'General',
                averageRating: parseFloat(doc.averageRating || doc.averagerating) || 0,
                consultationFee: parseFloat(doc.consultationFee || doc.consultationfee) || 0,
                image: doc.photoUrl || doc.photourl,
                isVerified,
                isDeactivated: !isVerified,
                isFavorite: true,
                favoritedAt: favoritedAtByDoctorId.get(fav.doctorId),
            };
        });

        return { message: 'Favorites retrieved successfully', data };
    }
}
