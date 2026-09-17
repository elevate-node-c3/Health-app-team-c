import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DoctorEntity } from '../entities/doctor.entity';
import { ClinicEntity } from '../entities/clinic.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { FilterDoctorsDto } from '../dto/filter-doctors.dto';
import { applyDoctorFilters } from '../utils/apply-doctor-filters';

export type DoctorSort = 'recommended' | 'priceAsc' | 'priceDesc';

interface ListFilteredInput {
  filters: FilterDoctorsDto;
  sort?: DoctorSort;
  page?: number;
  limit?: number;
  userId?: string;
}

@Injectable()
export class ListFilteredDoctorsUseCase {
  private readonly logger = new Logger(ListFilteredDoctorsUseCase.name);

  constructor(
    @InjectRepository(DoctorEntity)
    private readonly doctorRepo: Repository<DoctorEntity>,
    @InjectRepository(ClinicEntity)
    private readonly clinicRepo: Repository<ClinicEntity>,
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepo: Repository<OutboxEventEntity>,
    private readonly outboxProcessor: OutboxProcessorService,
  ) {}

  async execute(input: ListFilteredInput) {
    const { filters } = input;
    const sort: DoctorSort = input.sort ?? 'recommended';
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const limit = Math.min(50, Math.max(1, Math.floor(input.limit ?? 20)));

    if (filters.governorate && filters.city) {
      const pair = await this.clinicRepo.findOne({
        where: { governorate: filters.governorate, city: filters.city },
        select: ['id'],
      });
      if (!pair) {
        throw new BadRequestException({
          code: 'CATALOG_INVALID_CITY',
          message: `city '${filters.city}' does not belong to governorate '${filters.governorate}'`,
        });
      }
    }

    const qb = this.doctorRepo
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
      .groupBy('doctor.id, specialty.id');

    applyDoctorFilters(qb, filters);

    const [countSql, countParams] = qb.getQueryAndParameters();
    const countRows = (await this.doctorRepo.query(
      `SELECT COUNT(*)::int AS total FROM (${countSql}) AS filtered`,
      countParams,
    )) as Array<{ total: number }>;
    const total = countRows[0]?.total ?? 0;

    if (sort === 'priceAsc') {
      qb.orderBy('COALESCE(MIN(dc.consultationFee), 0)', 'ASC');
    } else if (sort === 'priceDesc') {
      qb.orderBy('COALESCE(MIN(dc.consultationFee), 0)', 'DESC');
    } else {
      qb.orderBy('doctor.averageRating', 'DESC');
    }
    qb.addOrderBy('doctor.id', 'ASC');

    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    const data = rows.map((r: any) => ({
      id: r.id,
      name: r.fullName ?? r.fullname,
      title: r.title,
      gender: r.gender,
      specialty: r.specialtyName ?? r.specialtyname ?? 'General',
      averageRating: parseFloat(r.averageRating ?? r.averagerating) || 0,
      consultationFee: parseFloat(r.consultationFee ?? r.consultationfee) || 0,
      image: r.photoUrl ?? r.photourl,
    }));

    this.persistFilterEvent({ ...filters }, sort, input.userId).catch((err) =>
      this.logger.error(`Filter analytics persist failed: ${err.message}`),
    );

    return { message: 'Doctors retrieved successfully', data, total, page, limit };
  }

  private async persistFilterEvent(filters: Record<string, unknown>, sort: DoctorSort, userId?: string) {
    const event = this.outboxRepo.create({
      aggregateType: 'CATALOG',
      eventType: 'catalog.filters_applied',
      payload: { filters, sort, userId: userId ?? null, appliedAt: new Date() },
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
