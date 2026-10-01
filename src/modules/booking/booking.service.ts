import { Injectable } from '@nestjs/common';
import { CreateHoldUseCase } from './use-case/create-hold.use-case';
import { ExtendHoldUseCase } from './use-case/extend-hold.use-case';
import { CreateHoldDto } from './dto/create-hold.dto';
import { CancelAppointmentUseCase } from './use-case/cancel-appointment.use-case';
import { PreviewCancellationUseCase } from './use-case/preview-cancellation.use-case';

@Injectable()
export class BookingService {
  constructor(
    private readonly createHold: CreateHoldUseCase,
    private readonly extendHold: ExtendHoldUseCase,
    private readonly previewCancel: PreviewCancellationUseCase,
    private readonly cancelAppointment: CancelAppointmentUseCase,
  ) { }

  createHoldFor(patientId: string, dto: CreateHoldDto) {
    return this.createHold.execute(patientId, dto);
  }

  extendHoldFor(patientId: string, holdId: string) {
    return this.extendHold.execute(patientId, holdId);
  }

  previewCancellationFor(patientId: string, appointmentId: string) {
    return this.previewCancel.execute(appointmentId, patientId);
  }

  cancelAppointmentFor(patientId: string, appointmentId: string) {
    return this.cancelAppointment.execute(appointmentId, patientId);
  }

}
