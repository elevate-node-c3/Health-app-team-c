import { IsNotEmpty, IsUUID } from 'class-validator';

export class PrescriptionParamsDto {
  @IsUUID()
  @IsNotEmpty()
  appointmentId: string;
}
