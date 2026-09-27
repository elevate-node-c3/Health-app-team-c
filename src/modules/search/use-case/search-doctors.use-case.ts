import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DoctorEntity } from '../../catalog/entities/doctor.entity';
import { DoctorClinicEntity } from '../../catalog/entities/doctor-clinic.entity';
import { SearchDoctorsDto, DoctorSortOption } from '../dto/search-doctors.dto';
import { SearchIdentity } from './search-doctors-and-specialties.use-case';
import { ResultListViewedEvent } from '../events/result-list-viewed.event';

@Injectable()
export class SearchDoctorsUseCase {
    private readonly logger = new Logger(SearchDoctorsUseCase.name);

    constructor(
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    private decodeCursor(cursorStr: string) {
        try {
            return JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf-8'));
        } catch {
            throw new BadRequestException('Invalid cursor');
        }
    }

    private encodeCursor(obj: any) {
        return Buffer.from(JSON.stringify(obj)).toString('base64');
    }

    async execute(dto: SearchDoctorsDto, identity: SearchIdentity) {
        const startTime = Date.now();
        const limit = dto.limit || 20;
        
        const qb = this.doctorRepo.createQueryBuilder('d')
            .leftJoinAndSelect('d.specialty', 's')
            .innerJoin(
                (subQuery) => {
                    return subQuery
                        .select('dc_sub.doctorId', 'doctorId')
                        .addSelect('MIN(dc_sub.consultationFee)', 'minFee')
                        .from(DoctorClinicEntity, 'dc_sub')
                        .where('dc_sub.isActive = :dcActive', { dcActive: true })
                        .groupBy('dc_sub.doctorId');
                },
                'min_fees',
                'min_fees."doctorId" = d.id'
            )
            .where('d.isActive = :dActive', { dActive: true })
            .andWhere('d.isVerified = :dVerified', { dVerified: true })
            .addSelect('min_fees."minFee"', 'startingFee');

        if (dto.specialtyId) {
            qb.andWhere('d.specialtyId = :specialtyId', { specialtyId: dto.specialtyId });
        }

        if (dto.q) {
            const escapedQuery = dto.q.replace(/[%_\\]/g, '\\$&');
            qb.andWhere(
                '(LOWER(d.fullName) LIKE LOWER(:pattern) OR LOWER(s.name) LIKE LOWER(:pattern) OR LOWER(ARRAY_TO_STRING(d.subspecialties, \',\')) LIKE LOWER(:pattern))',
                { pattern: `%${escapedQuery}%` }
            );
        }

        const sortOption = dto.sort || DoctorSortOption.MOST_RECOMMENDED;

        if (dto.cursor) {
            const cursorObj = this.decodeCursor(dto.cursor);
            if (sortOption === DoctorSortOption.MOST_RECOMMENDED) {
                qb.andWhere(`(
                    (d.averageRating < :cRating) OR 
                    (d.averageRating = :cRating AND d.totalReviews < :cReviews) OR 
                    (d.averageRating = :cRating AND d.totalReviews = :cReviews AND d.id > :cId)
                )`, { cRating: cursorObj.rating, cReviews: cursorObj.reviews, cId: cursorObj.id });
            } else if (sortOption === DoctorSortOption.PRICE_ASC) {
                qb.andWhere(`(
                    (min_fees."minFee" > :cFee) OR 
                    (min_fees."minFee" = :cFee AND d.id > :cId)
                )`, { cFee: cursorObj.fee, cId: cursorObj.id });
            } else if (sortOption === DoctorSortOption.PRICE_DESC) {
                qb.andWhere(`(
                    (min_fees."minFee" < :cFee) OR 
                    (min_fees."minFee" = :cFee AND d.id > :cId)
                )`, { cFee: cursorObj.fee, cId: cursorObj.id });
            }
        }

        if (sortOption === DoctorSortOption.MOST_RECOMMENDED) {
            qb.orderBy('d.averageRating', 'DESC')
              .addOrderBy('d.totalReviews', 'DESC')
              .addOrderBy('d.id', 'ASC');
        } else if (sortOption === DoctorSortOption.PRICE_ASC) {
            qb.orderBy('min_fees."minFee"', 'ASC')
              .addOrderBy('d.id', 'ASC');
        } else if (sortOption === DoctorSortOption.PRICE_DESC) {
            qb.orderBy('min_fees."minFee"', 'DESC')
              .addOrderBy('d.id', 'ASC');
        }

        qb.take(limit + 1); // fetch one extra to see if there's a next page

        const { entities, raw } = await qb.getRawAndEntities();
        
        const hasNextPage = entities.length > limit;
        const resultEntities = hasNextPage ? entities.slice(0, limit) : entities;

        const results = resultEntities.map((doctor, index) => {
            const rawItem = raw.find((r) => r.d_id === doctor.id);
            const fee = rawItem ? Number(rawItem.startingFee) : 0;
            return {
                id: doctor.id,
                fullName: doctor.fullName,
                title: doctor.title,
                photoUrl: doctor.photoUrl,
                experienceYears: doctor.experienceYears,
                averageRating: Number(doctor.averageRating),
                totalReviews: doctor.totalReviews,
                specialtyName: doctor.specialty ? doctor.specialty.name : null,
                startingFee: fee,
            };
        });

        let nextCursor: string | null = null;
        if (hasNextPage) {
            const lastEntity = resultEntities[resultEntities.length - 1];
            const lastResult = results[results.length - 1];
            if (sortOption === DoctorSortOption.MOST_RECOMMENDED) {
                nextCursor = this.encodeCursor({
                    rating: Number(lastEntity.averageRating),
                    reviews: lastEntity.totalReviews,
                    id: lastEntity.id
                });
            } else if (sortOption === DoctorSortOption.PRICE_ASC || sortOption === DoctorSortOption.PRICE_DESC) {
                nextCursor = this.encodeCursor({
                    fee: lastResult.startingFee,
                    id: lastEntity.id
                });
            }
        }

        this.eventEmitter.emit(
            'results.viewed',
            new ResultListViewedEvent({
                query: dto.q,
                specialtyId: dto.specialtyId,
                userId: identity.userId,
                deviceId: identity.deviceId,
                resultsCount: results.length,
                timestamp: new Date(),
                clientIp: identity.clientIp,
                sortOption: sortOption,
            }),
        );

        return {
            success: true,
            data: {
                doctors: results,
                nextCursor,
            },
            metadata: {
                query: dto.q,
                specialtyId: dto.specialtyId,
                sort: sortOption,
                requestId: dto.requestId ?? null,
                timestamp: dto.timestamp ?? new Date().toISOString(),
                tookMs: Date.now() - startTime,
            },
        };
    }
}
