import { IsUUID, IsNotEmpty, IsDateString, Matches } from 'class-validator';

export class CreateHoldDto {
  @IsUUID()
  @IsNotEmpty()
  doctorId: string;

  @IsUUID()
  @IsNotEmpty()
  clinicId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  @IsNotEmpty()
  startTime: string;
}
