import { IsOptional, IsString, IsDateString } from 'class-validator';

export class BookingIntentDto {
    @IsOptional()
    @IsString()
    doctorId?: string;

    @IsOptional()
    @IsString()
    clinicId?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    @IsOptional()
    @IsString()
    time?: string;
}
