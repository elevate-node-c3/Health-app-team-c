import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DoctorGender, DoctorTitle } from '../entities/doctor.entity';
import { PlaceType } from '../entities/clinic.entity';

export enum AvailabilityFilter {
  TODAY = 'Today',
  TOMORROW = 'Tomorrow',
}

function toStringArray(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return value;
}

export class FilterDoctorsDto {
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(DoctorGender, { each: true })
  genders?: DoctorGender[];

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayMaxSize(2)
  @IsEnum(AvailabilityFilter, { each: true })
  availability?: AvailabilityFilter[];

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(PlaceType, { each: true })
  places?: PlaceType[];

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(DoctorTitle, { each: true })
  titles?: DoctorTitle[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  governorate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsUUID()
  specialtyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
