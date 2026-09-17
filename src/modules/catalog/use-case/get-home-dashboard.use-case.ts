import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DoctorEntity } from '../../catalog/entities/doctor.entity';
import { SpecialtyEntity } from '../../catalog/entities/specialty.entity';
import { RedisService } from '../../../common/redis/redis.service';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { ArticleEntity } from '../entities/article.entity';
import { FavoriteEntity } from '../entities/favorite.entity';
import { CACHE_KEYS } from 'src/common/constants/cache-keys.constant';

@Injectable()
export class GetHomeDashboardUseCase {
    constructor(
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
        @InjectRepository(SpecialtyEntity)
        private readonly specialtyRepo: Repository<SpecialtyEntity>,
        @InjectRepository(ArticleEntity)
        private readonly articleRepo: Repository<ArticleEntity>,
        @InjectRepository(FavoriteEntity)
        private readonly favoriteRepo: Repository<FavoriteEntity>,
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepo: Repository<OutboxEventEntity>,
        private readonly redisService: RedisService,
    ) { }

    async execute(user?: { id: string; fullName: string }, clientIp?: string, queryRunner?: any) {

        // 1. Calculate Cairo Greeting
        const cairoHour = new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false });
        const hourNum = parseInt(cairoHour, 10);

        let timeGreeting = 'Good morning';
        if (hourNum >= 12 && hourNum < 17) {
            timeGreeting = 'Good afternoon';
        } else if (hourNum >= 17) {
            timeGreeting = 'Good evening';
        }

        const greeting = user?.fullName
            ? `${timeGreeting}, ${user.fullName}`
            : timeGreeting;

        // 2. Public Data CACHE (Specialties, Top Doctors, Articles)
        const cacheKey = CACHE_KEYS.CATALOG_HOME_PUBLIC_DATA;
        let cachedData = await this.redisService.get<{ categories: any[]; topDoctors: any[]; articles: any[] }>(cacheKey);

        if (!cachedData) {
            const categories = await this.specialtyRepo.find({
                select: ['id', 'name'],
                take: 8,
            });

            // Safe Query using getRawMany
            const topDoctorsRaw = await this.doctorRepo.createQueryBuilder('doctor')
                .leftJoin('doctor.doctorClinics', 'dc', 'dc.isActive = :isActive', { isActive: true })
                .leftJoin('doctor.specialty', 'specialty')
                .select([
                    'doctor.id AS id',
                    'doctor.fullName AS fullName',
                    'specialty.name AS specialtyName',
                    'COALESCE(MIN(dc.consultationFee), 0) AS consultationFee',
                    'doctor.averageRating AS averageRating',
                    'doctor.photoUrl AS photoUrl',
                ])
                .where('doctor.isActive = :active', { active: true })
                .groupBy('doctor.id, specialty.id')
                .orderBy('doctor.averageRating', 'DESC')
                .limit(10)
                .getRawMany();

            const topDoctors = topDoctorsRaw.map((doc) => ({
                id: doc.id,
                name: doc.fullName || doc.fullname || doc.doctor_fullname,
                specialty: doc.specialtyName || doc.specialtyname || doc.specialty_name || 'General',
                averageRating: parseFloat(doc.averageRating || doc.averagerating) || 0,
                consultationFee: parseFloat(doc.consultationFee || doc.consultationfee) || 0,
                image: doc.photoUrl || doc.photourl,
            }));

            // Fetch newest published articles
            const articles = await this.articleRepo.find({
                where: { isPublished: true },
                order: { publishedAt: 'DESC' },
                take: 5,
                select: ['id', 'title', 'summary', 'imageUrl', 'publishedAt'],
            });

            cachedData = { categories, topDoctors, articles };
            await this.redisService.set(cacheKey, cachedData, 600);
        }

        // 3. Personalized Data for Signed-in User
        let favoriteDoctorIds: string[] = [];
        let upcomingAppointment = null;
        let recentVisit = null;

        if (user?.id) {
            const userFavorites = await this.favoriteRepo.find({
                where: { userId: user.id },
                select: ['doctorId'],
            });
            favoriteDoctorIds = userFavorites.map((f) => f.doctorId);
        }

        const topDoctorsWithFavorites = cachedData.topDoctors.map((doc) => ({
            ...doc,
            ...(user?.id ? { isFavorite: favoriteDoctorIds.includes(doc.id) } : {}),
        }));

        // 4. Domain Event Registration
        const activeRepo = queryRunner ? queryRunner.manager.getRepository(OutboxEventEntity) : this.outboxRepo;
        await activeRepo.save({
            aggregateType: 'ANALYTICS',
            eventType: 'HOME_PAGE_OPENED',
            payload: {
                userId: user?.id || null,
                ipAddress: clientIp,
                openedAt: new Date(),
            },
        });

        // 5. Final Response Payload
        const response: any = {
            greeting,
            categories: cachedData.categories,
            topDoctors: topDoctorsWithFavorites,
            articles: cachedData.articles,
        };

        if (user?.id) {
            if (upcomingAppointment) {
                response.upcomingAppointment = upcomingAppointment;
            }
            if (recentVisit) {
                response.recentVisit = recentVisit;
            }
        }

        return response;
    }
}