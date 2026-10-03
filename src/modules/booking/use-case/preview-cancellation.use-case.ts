import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    AppointmentEntity,
    AppointmentStatus,
    CancellationOutcome,
} from 'src/modules/catalog/entities/appointment.entity';
import { CancellationDecision, decideCancellation } from '../policies/cancellation-policy';
import { PreviewCancellationResponseDto } from '../dto/cancel-appointment.dto';
import { getAppointmentStart } from '../helpers/appiontment-time';


@Injectable()
export class PreviewCancellationUseCase {
    constructor(
        @InjectRepository(AppointmentEntity)
        private readonly appointmentRepo: Repository<AppointmentEntity>,
    ) { }

    async execute(
        appointmentId: string,
        patientId: string,
    ): Promise<PreviewCancellationResponseDto> {
        const appointment = await this.appointmentRepo.findOne({
            where: { id: appointmentId },
        });

        if (!appointment || appointment.patientId !== patientId) {
            throw new NotFoundException('Appointment not found');
        }

        if (appointment.status === AppointmentStatus.CANCELLED) {
            throw new BadRequestException('Appointment is already cancelled');
        }

        if (appointment.status === AppointmentStatus.COMPLETED) {
            throw new BadRequestException('Cannot cancel a completed appointment');
        }

        const decision = decideCancellation(getAppointmentStart(appointment));

        if (decision === CancellationDecision.ALREADY_STARTED) {
            throw new BadRequestException('Cannot cancel an appointment that has already started');
        }

        const outcome =
            decision === CancellationDecision.FREE
                ? CancellationOutcome.FREE
                : CancellationOutcome.NO_REFUND;
        const isFree = outcome === CancellationOutcome.FREE;
        const fee = Number(appointment.snapshotConsultationFee ?? 0);

        return {
            appointmentId: appointment.id,
            outcome,
            refundAmount: isFree ? fee : 0,
            feeAmount: isFree ? 0 : fee,
            message: isFree ? 'No fees will be charged!' : 'No refund available if you cancel now!',
        };
    }
}