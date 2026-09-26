import { IsOptional, IsString, MaxLength, IsEnum, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum DoctorSortOption {
    MOST_RECOMMENDED = 'MOST_RECOMMENDED',
    PRICE_ASC = 'PRICE_ASC',
    PRICE_DESC = 'PRICE_DESC'
}

export class SearchDoctorsDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    q?: string;

    @IsOptional()
    @IsUUID()
    specialtyId?: string;

    @IsOptional()
    @IsEnum(DoctorSortOption)
    sort?: DoctorSortOption = DoctorSortOption.MOST_RECOMMENDED;

    @IsOptional()
    @IsString()
    cursor?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @IsOptional()
    @IsString()
    requestId?: string;

    @IsOptional()
    @IsString()
    timestamp?: string;
}
