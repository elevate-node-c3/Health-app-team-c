import { CancellationOutcome } from "src/modules/catalog/entities/appointment.entity";

export interface PreviewCancellationResponseDto {
    appointmentId: string;
    outcome: CancellationOutcome;
    feeAmount: number;
    refundAmount: number;
    message: string;
}

export interface CancelAppointmentResponseDto {
    appointmentId: string;
    cancelledAt: Date;
    outcome: CancellationOutcome;
    refundStatus: 'NOT_APPLICABLE' | 'PENDING' | 'ISSUED';
    message: string;
}