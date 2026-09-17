import { BadRequestException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { DoctorEntity, DoctorGender } from '../entities/doctor.entity';
import { AvailabilityFilter, FilterDoctorsDto } from '../dto/filter-doctors.dto';

const CAIRO_TZ = 'Africa/Cairo';
const DAY_TOKENS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function getCairoDayToken(date: Date = new Date()): string {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: CAIRO_TZ, weekday: 'short' }).format(date);
  return DAY_TOKENS.find((d) => d.toLowerCase() === short.toLowerCase()) ?? 'Sat';
}

export function getCairoTomorrowToken(now: Date = new Date()): string {
  return getCairoDayToken(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}

function isFullSet<T>(values: T[] | undefined, all: readonly T[]): boolean {
  if (!values || values.length === 0) return true;
  return all.every((v) => values.includes(v));
}

export function applyDoctorFilters(
  qb: SelectQueryBuilder<DoctorEntity>,
  filters: FilterDoctorsDto,
  now: Date = new Date(),
): SelectQueryBuilder<DoctorEntity> {
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) {
    throw new BadRequestException({
      code: 'CATALOG_INVALID_PRICE_RANGE',
      message: 'minPrice must not exceed maxPrice',
    });
  }

  if (filters.genders && !isFullSet(filters.genders, [DoctorGender.MALE, DoctorGender.FEMALE])) {
    qb.andWhere('doctor.gender IN (:...genders)', { genders: filters.genders });
  }

  if (filters.titles && filters.titles.length > 0) {
    qb.andWhere('doctor.title IN (:...titles)', { titles: filters.titles });
  }

  if (filters.places && filters.places.length > 0) {
    qb.andWhere('clinic.placeType IN (:...places)', { places: filters.places });
  }

  if (filters.governorate) {
    qb.andWhere('clinic.governorate = :governorate', { governorate: filters.governorate });
  }

  if (filters.city) {
    qb.andWhere('clinic.city = :city', { city: filters.city });
  }

  if (filters.specialtyId) {
    qb.andWhere('doctor.specialtyId = :specialtyId', { specialtyId: filters.specialtyId });
  }

  if (filters.rating !== undefined) {
    qb.andWhere('doctor.averageRating >= :rating', { rating: filters.rating });
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
      if (filters.maxPrice >= 1000) {
        qb.andHaving('COALESCE(MIN(dc.consultationFee), 0) >= :minPrice', { minPrice: filters.minPrice });
      } else {
        qb.andHaving('COALESCE(MIN(dc.consultationFee), 0) BETWEEN :minPrice AND :maxPrice', {
          minPrice: filters.minPrice,
          maxPrice: filters.maxPrice,
        });
      }
    } else if (filters.minPrice !== undefined) {
      qb.andHaving('COALESCE(MIN(dc.consultationFee), 0) >= :minPrice', { minPrice: filters.minPrice });
    } else if (filters.maxPrice !== undefined && filters.maxPrice < 1000) {
      qb.andHaving('COALESCE(MIN(dc.consultationFee), 0) <= :maxPrice', { maxPrice: filters.maxPrice });
    }
  }

  const availability = filters.availability ?? [];
  if (availability.length > 0) {
    const days = new Set<string>();
    if (availability.includes(AvailabilityFilter.TODAY)) days.add(getCairoDayToken(now));
    if (availability.includes(AvailabilityFilter.TOMORROW)) days.add(getCairoTomorrowToken(now));
    const dayList = [...days];
    if (dayList.length > 0) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM doctor_clinics dc_avail WHERE dc_avail."doctorId" = doctor.id AND dc_avail."isActive" = true AND dc_avail.schedule -> 'days' ?| :availDays)`,
        { availDays: dayList },
      );
    }
  }

  return qb;
}
