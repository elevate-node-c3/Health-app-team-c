import { IsNumber, IsOptional, Max, Min, ValidateIf, IsString, IsUUID } from 'class-validator';

export class SearchMapDto {
    @IsNumber()
    @Min(-90)
    @Max(90)
    south: number;

    @IsNumber()
    @Min(-90)
    @Max(90)
    north: number;

    @IsNumber()
    @Min(-180)
    @Max(180)
    west: number;

    @IsNumber()
    @Min(-180)
    @Max(180)
    east: number;

    @ValidateIf(o => o.longitude !== undefined)
    @IsNumber()
    @Min(-90)
    @Max(90)
    latitude?: number;

    @ValidateIf(o => o.latitude !== undefined)
    @IsNumber()
    @Min(-180)
    @Max(180)
    longitude?: number;

    @IsOptional()
    @IsUUID()
    specialtyId?: string;

    @IsOptional()
    @IsString()
    doctorName?: string;
}
