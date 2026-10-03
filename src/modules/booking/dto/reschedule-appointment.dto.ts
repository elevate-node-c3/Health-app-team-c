import { IsNotEmpty, Matches } from 'class-validator';

export class RescheduleAppointmentDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsNotEmpty()
  date: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  @IsNotEmpty()
  newStartTime: string;
}
