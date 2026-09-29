import { IsDateString, IsUUID, IsNotEmpty } from 'class-validator';

export class GetDoctorAvailabilityDto {
    @IsUUID()
    @IsNotEmpty()
    clinicId: string;

    @IsDateString()
    @IsNotEmpty()
    date: string; // YYYY-MM-DD format expected
}
