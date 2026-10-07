import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { AppointmentEntity } from 'src/modules/catalog/entities/appointment.entity';
import { DoctorClinicEntity } from 'src/modules/catalog/entities/doctor-clinic.entity';
import {
    AppointmentSummary,
    CatalogGateway,
    DoctorClinicInfo,
    DoctorSummary,
    SpecialtyInfo,
} from './catalog.gateway';
import { escapeLike, nameTokens } from './tool-args';
import { parseWorkingHours } from './working-hours';


const APPOINTMENT_START_FIELDS = [
    'startsAt',
    'startTime',
    'startAt',
    'appointmentDate',
    'scheduledAt',
    'slotStart',
    'date',
] as const;


const SPECIALTY_NAME_FIELDS = ['name', 'nameEn', 'nameAr', 'title', 'titleEn', 'titleAr', 'label'] as const;

function specialtyNames(specialty: unknown): string[] {
    if (!specialty || typeof specialty !== 'object') return [];
    const names: string[] = [];
    for (const field of SPECIALTY_NAME_FIELDS) {
        const v = (specialty as Record<string, unknown>)[field];
        if (typeof v === 'string' && v.trim() && !names.includes(v.trim())) names.push(v.trim());
    }
    return names;
}

const specialtyLabel = (specialty: unknown): string | null => specialtyNames(specialty)[0] ?? null;

function readStart(appointment: object): Date | null {
    for (const field of APPOINTMENT_START_FIELDS) {
        const value = (appointment as Record<string, unknown>)[field];
        if (value) {
            const date = new Date(value as string | number | Date);
            if (!Number.isNaN(date.getTime())) return date;
        }
    }
    return null;
}


@Injectable()
export class TypeOrmCatalogGateway implements CatalogGateway {
    constructor(
        @InjectRepository(DoctorEntity)
        private readonly doctorRepository: Repository<DoctorEntity>,
        @InjectRepository(AppointmentEntity)
        private readonly appointmentRepository: Repository<AppointmentEntity>,
        @InjectRepository(DoctorClinicEntity)
        private readonly doctorClinicRepository: Repository<DoctorClinicEntity>,
    ) { }

    async listSpecialties(): Promise<SpecialtyInfo[]> {
        const relation = this.doctorRepository.metadata.findRelationWithPropertyPath('specialty');
        if (!relation) throw new Error('DoctorEntity.specialty is not a relation');
        const specialtyRepo = this.doctorRepository.manager.getRepository<ObjectLiteral>(
            relation.inverseEntityMetadata.target as EntityTarget<ObjectLiteral>,
        );

        const counts = await this.doctorRepository
            .createQueryBuilder('d')
            .innerJoin('d.specialty', 's')
            .select('s.id', 'id')
            .addSelect('COUNT(d.id)', 'count')
            .where('d.isActive = :active', { active: true })
            .andWhere('d.isVerified = :verified', { verified: true })
            .groupBy('s.id')
            .getRawMany<{ id: string | number; count: string }>();

        const countById = new Map(counts.map((c) => [String(c.id), Number(c.count)]));
        const specialties = await specialtyRepo.find();

        return specialties
            .filter((s) => countById.has(String(s.id)))
            .map((s) => {
                const [name, ...aliases] = specialtyNames(s);
                return {
                    id: String(s.id),
                    name: name ?? String(s.id),
                    aliases,
                    doctorCount: countById.get(String(s.id)) ?? 0,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    async searchDoctors(query: { specialtyId?: string; name?: string; limit: number }) {
        const qb = this.doctorRepository
            .createQueryBuilder('d')
            .leftJoinAndSelect('d.specialty', 's')
            .where('d.isActive = :active', { active: true })
            .andWhere('d.isVerified = :verified', { verified: true });

        if (query.specialtyId) qb.andWhere('s.id = :specialtyId', { specialtyId: query.specialtyId });
        nameTokens(query.name).forEach((token, i) => {
            qb.andWhere(`d.fullName ILIKE :nameToken${i}`, { [`nameToken${i}`]: `%${escapeLike(token)}%` });
        });

        const [rows, total] = await qb
            .orderBy('d.fullName', 'ASC')
            .addOrderBy('d.id', 'ASC')
            .take(query.limit)
            .getManyAndCount();

        return {
            doctors: rows.map<DoctorSummary>((d) => ({
                id: d.id,
                name: d.fullName,
                specialty: specialtyLabel(d.specialty),
            })),
            total,
        };
    }

    async getDoctor(doctorId: string): Promise<DoctorSummary | null> {
        const d = await this.doctorRepository.findOne({
            where: { id: doctorId, isActive: true, isVerified: true },
            relations: { specialty: true },
        });
        return d ? { id: d.id, name: d.fullName, specialty: specialtyLabel(d.specialty) } : null;
    }

    async getDoctorClinics(doctorId: string): Promise<DoctorClinicInfo[]> {
        const rows = await this.doctorClinicRepository.find({
            where: { doctorId, isActive: true },
            relations: { clinic: true },
        });
        return rows
            .filter((dc) => dc.clinic?.isActive !== false)
            .map((dc) => ({
                clinicId: dc.clinicId,
                clinicName: dc.clinic?.name ?? null,
                consultationFee: dc.consultationFee ?? null,
                workingHours: parseWorkingHours(dc.schedule),
            }));
    }

    async getAppointments(patientId: string, limit: number) {
        const rows = await this.appointmentRepository.find({
            where: { patientId },
            relations: { doctor: { specialty: true }, clinic: true },
            order: { createdAt: 'DESC' },
            take: 30,
        });

        const now = Date.now();
        const mapped = rows.map((a) => {
            const start = readStart(a);
            const summary: AppointmentSummary = {
                doctorName: a.doctor?.fullName ?? null,
                specialty: specialtyLabel(a.doctor?.specialty),
                clinicName: a.clinic?.name ?? null,
                status: String(a.status),
                startsAt: start ? start.toISOString() : null,
            };
            return { summary, start };
        });

        const upcoming = mapped
            .filter((m) => m.start && m.start.getTime() >= now)
            .sort((a, b) => a.start!.getTime() - b.start!.getTime());
        const rest = mapped.filter((m) => !(m.start && m.start.getTime() >= now));

        return {
            appointments: [...upcoming, ...rest].slice(0, limit).map((m) => m.summary),
            datesAvailable: mapped.length === 0 || mapped.some((m) => m.start !== null),
        };
    }
}