import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DoctorEntity } from '../../catalog/entities/doctor.entity';
import { SpecialtyEntity } from '../../catalog/entities/specialty.entity';
import { SearchQueryDto } from '../dto/search-query.dto';
import { SearchPerformedEvent } from '../events/search-performed.event';

export interface SearchIdentity {
    userId?: string;
    deviceId?: string;
    clientIp?: string;
}

@Injectable()
export class SearchDoctorsAndSpecialtiesUseCase {
    private readonly logger = new Logger(SearchDoctorsAndSpecialtiesUseCase.name);

    constructor(
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
        @InjectRepository(SpecialtyEntity)
        private readonly specialtyRepo: Repository<SpecialtyEntity>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    private escapeLikeQuery(query: string): string {
        return query.replace(/[%_\\]/g, '\\$&');
    }

    async execute(dto: SearchQueryDto, identity: SearchIdentity) {
        const startTime = Date.now();
        const rawQuery = (dto.q || '').trim();

        if (!rawQuery) {
            return {
                success: true,
                data: { specialties: [], doctors: [], totalResults: 0 },
                metadata: {
                    query: rawQuery,
                    requestId: dto.requestId ?? null,
                    timestamp: dto.timestamp ?? new Date().toISOString(),
                    tookMs: Date.now() - startTime,
                },
            };
        }

        if (rawQuery.length > 500) {
            throw new BadRequestException('Search query must not exceed 500 characters.');
        }

        const escaped = this.escapeLikeQuery(rawQuery);
        const lowerRaw = rawQuery.toLowerCase();

        const [specialtiesRaw, doctorsRaw] = await Promise.all([
            this.searchSpecialties(escaped),
            this.searchDoctors(escaped),
        ]);

        const rankedSpecialties = this.rankSpecialties(specialtiesRaw, lowerRaw);
        const rankedDoctors = this.rankDoctors(doctorsRaw, lowerRaw);
        const totalResults = rankedSpecialties.length + rankedDoctors.length;

        this.eventEmitter.emit(
            'search.performed',
            new SearchPerformedEvent({
                query: rawQuery,
                userId: identity.userId,
                deviceId: identity.deviceId,
                resultsCount: totalResults,
                timestamp: new Date(),
                clientIp: identity.clientIp,
            }),
        );

        return {
            success: true,
            data: {
                specialties: rankedSpecialties,
                doctors: rankedDoctors,
                totalResults,
            },
            metadata: {
                query: rawQuery,
                requestId: dto.requestId ?? null,
                timestamp: dto.timestamp ?? new Date().toISOString(),
                tookMs: Date.now() - startTime,
            },
        };
    }

    private async searchSpecialties(escapedQuery: string): Promise<SpecialtyEntity[]> {
        return this.specialtyRepo
            .createQueryBuilder('s')
            .where('s.isActive = :isActive', { isActive: true })
            .andWhere(
                '(LOWER(s.name) LIKE LOWER(:pattern) OR LOWER(s.description) LIKE LOWER(:pattern))',
                { pattern: `%${escapedQuery}%` },
            )
            .getMany();
    }

    private async searchDoctors(escapedQuery: string): Promise<DoctorEntity[]> {
        return this.doctorRepo
            .createQueryBuilder('d')
            .leftJoinAndSelect('d.specialty', 's')
            .leftJoin('d.doctorClinics', 'dc')
            .where('d.isActive = :isActive', { isActive: true })
            .andWhere('d.isVerified = :isVerified', { isVerified: true })
            .andWhere(
                '(LOWER(d.fullName) LIKE LOWER(:pattern) OR LOWER(d.title) LIKE LOWER(:pattern) OR LOWER(s.name) LIKE LOWER(:pattern) OR LOWER(ARRAY_TO_STRING(d.subspecialties, \',\')) LIKE LOWER(:pattern))',
                { pattern: `%${escapedQuery}%` },
            )
            .getMany();
    }

    private rankSpecialties(specialties: SpecialtyEntity[], lowerQuery: string) {
        return specialties
            .map((s) => {
                const lowerName = s.name.toLowerCase();
                const lowerDesc = (s.description || '').toLowerCase();
                let score = 0;

                if (lowerName === lowerQuery) score += 100;
                else if (lowerName.startsWith(lowerQuery)) score += 80;
                else if (lowerName.includes(lowerQuery)) score += 40;
                else if (lowerDesc.startsWith(lowerQuery)) score += 30;
                else score += 10;

                return { item: s, score };
            })
            .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
            .map((entry) => ({
                id: entry.item.id,
                name: entry.item.name,
                description: entry.item.description,
            }));
    }

    private rankDoctors(doctors: DoctorEntity[], lowerQuery: string) {
        return doctors
            .map((d) => {
                const lowerName = d.fullName.toLowerCase();
                const lowerSpecialty = d.specialty ? d.specialty.name.toLowerCase() : '';
                let score = 0;

                if (lowerName === lowerQuery) score += 100;
                else if (lowerName.startsWith(lowerQuery)) score += 80;
                else if (lowerName.includes(lowerQuery)) score += 50;
                else if (lowerSpecialty.startsWith(lowerQuery)) score += 40;
                else score += 20;

                return { item: d, score };
            })
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const ratingB = Number(b.item.averageRating) || 0;
                const ratingA = Number(a.item.averageRating) || 0;
                if (ratingB !== ratingA) return ratingB - ratingA;
                return a.item.fullName.localeCompare(b.item.fullName);
            })
            .map((entry) => ({
                id: entry.item.id,
                fullName: entry.item.fullName,
                title: entry.item.title,
                photoUrl: entry.item.photoUrl,
                experienceYears: entry.item.experienceYears,
                averageRating: Number(entry.item.averageRating),
                totalReviews: entry.item.totalReviews,
                specialtyName: entry.item.specialty ? entry.item.specialty.name : null,
            }));
    }
}
