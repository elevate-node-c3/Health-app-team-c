import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    AppointmentEntity,
    AppointmentStatus,
    CancellationOutcome,
} from 'src/modules/catalog/entities/appointment.entity';
import { Repository } from 'typeorm';

@Injectable()
export class GetPaymentSummaryUseCase {
    constructor(
        @InjectRepository(AppointmentEntity)
        private readonly appointmentRepository: Repository<AppointmentEntity>,
    ) { }

    async execute(userId: string, appointmentId: string) {
        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId, patientId: userId },
            relations: ['doctor', 'clinic'],
        });

        if (!appointment) {
            throw new NotFoundException(
                'Appointment not found or does not belong to the user',
            );
        }

        if (appointment.status !== AppointmentStatus.CANCELLED) {
            throw new BadRequestException(
                `Cannot generate payment summary for appointment with status: ${appointment.status}`,
            );
        }

        const basePrice = Number(appointment.snapshotConsultationFee || 0);

        const isFreeCancellation =
            appointment.cancellationOutcome === CancellationOutcome.FREE;
        const totalAmount = isFreeCancellation ? 0 : basePrice;

        return {
            appointmentId: appointment.id,
            bookingPrice: Number(basePrice.toFixed(2)),
            cancellationOutcome: appointment.cancellationOutcome,
            total: Number(totalAmount.toFixed(2)),
            currency: 'EGP',
        };
    }
}