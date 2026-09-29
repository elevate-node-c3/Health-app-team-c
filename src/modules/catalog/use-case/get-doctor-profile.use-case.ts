import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DoctorEntity } from '../entities/doctor.entity';
import { ReviewEntity } from '../entities/review.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

export interface GetDoctorProfileInput {
    doctorId: string;
    userId?: string;
}

@Injectable()
export class GetDoctorProfileUseCase {
    private readonly logger = new Logger(GetDoctorProfileUseCase.name);

    constructor(
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
        @InjectRepository(ReviewEntity)
        private readonly reviewRepo: Repository<ReviewEntity>,
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepo: Repository<OutboxEventEntity>,
        private readonly outboxProcessor: OutboxProcessorService,
    ) { }

    async execute(input: GetDoctorProfileInput) {
        const doctor = await this.doctorRepo.findOne({
            where: { id: input.doctorId, isActive: true },
            relations: ['specialty', 'doctorClinics', 'doctorClinics.clinic'],
        });

        if (!doctor) {
            throw new NotFoundException('Doctor not found or inactive');
        }

        const reviews = await this.reviewRepo.find({
            where: { doctorId: input.doctorId },
            order: { createdAt: 'DESC' },
            take: 10,
        });

        // Filter active clinics
        const activeClinics = doctor.doctorClinics.filter(dc => dc.isActive && dc.clinic.isActive).map(dc => ({
            clinicId: dc.clinicId,
            name: dc.clinic.name,
            address: dc.clinic.address,
            city: dc.clinic.city,
            governorate: dc.clinic.governorate,
            consultationFee: Number(dc.consultationFee),
        }));

        this.persistProfileViewEvent(input.doctorId, input.userId).catch((err) =>
            this.logger.error(`Profile analytics persist failed: ${err.message}`),
        );

        return {
            success: true,
            data: {
                id: doctor.id,
                fullName: doctor.fullName,
                title: doctor.title,
                photoUrl: doctor.photoUrl,
                experienceYears: doctor.experienceYears,
                university: doctor.university,
                subspecialties: doctor.subspecialties,
                averageRating: Number(doctor.averageRating),
                totalReviews: doctor.totalReviews,
                totalPatients: doctor.totalPatients,
                gender: doctor.gender,
                isVerified: doctor.isVerified,
                about: doctor.about,
                qa: doctor.qa,
                specialty: doctor.specialty ? {
                    id: doctor.specialty.id,
                    name: doctor.specialty.name,
                } : null,
                clinics: activeClinics,
                reviews: reviews.map(r => ({
                    id: r.id,
                    patientName: r.patientName,
                    rating: r.rating,
                    comment: r.comment,
                    createdAt: r.createdAt,
                })),
            },
        };
    }

    private async persistProfileViewEvent(doctorId: string, userId?: string) {
        const event = this.outboxRepo.create({
            aggregateType: 'CATALOG',
            eventType: 'catalog.doctor_profile_viewed',
            payload: { doctorId, userId: userId ?? null, viewedAt: new Date() },
            isProcessed: false,
        });
        const saved = await this.outboxRepo.save(event);
        setImmediate(() => {
            this.outboxProcessor.triggerPublish(saved.id).catch((err) => {
                this.logger.error(`Instant outbox publish failed for event ID ${saved.id}: ${err.message}`);
            });
        });
    }
}
