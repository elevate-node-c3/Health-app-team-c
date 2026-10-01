import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { GetPaymentSummaryUseCase } from './get-payment-summary.use-case';
import {
    AppointmentEntity,
    AppointmentStatus,
    CancellationOutcome,
} from 'src/modules/catalog/entities/appointment.entity';

describe('GetPaymentSummaryUseCase', () => {
    let useCase: GetPaymentSummaryUseCase;
    let appointmentRepository: jest.Mocked<Repository<AppointmentEntity>>;

    const mockRepository = () => ({
        findOne: jest.fn(),
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetPaymentSummaryUseCase,
                {
                    provide: getRepositoryToken(AppointmentEntity),
                    useValue: mockRepository(),
                },
            ],
        }).compile();

        useCase = module.get<GetPaymentSummaryUseCase>(GetPaymentSummaryUseCase);
        appointmentRepository = module.get(getRepositoryToken(AppointmentEntity));
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    describe('execute', () => {
        const userId = 'user-uuid-123';
        const appointmentId = 'appointment-uuid-456';

        it('should throw NotFoundException if appointment does not exist', async () => {
            appointmentRepository.findOne.mockResolvedValue(null);

            await expect(useCase.execute(userId, appointmentId)).rejects.toThrow(
                NotFoundException,
            );
            expect(appointmentRepository.findOne).toHaveBeenCalledWith({
                where: { id: appointmentId, patientId: userId },
                relations: ['doctor', 'clinic'],
            });
        });

        it('should throw BadRequestException if appointment status is not CANCELLED', async () => {
            const mockAppointment = {
                id: appointmentId,
                patientId: userId,
                status: AppointmentStatus.BOOKED,
            } as AppointmentEntity;

            appointmentRepository.findOne.mockResolvedValue(mockAppointment);

            await expect(useCase.execute(userId, appointmentId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should return total = 0 when cancellation outcome is FREE', async () => {
            const mockAppointment = {
                id: appointmentId,
                patientId: userId,
                status: AppointmentStatus.CANCELLED,
                snapshotConsultationFee: 250.0,
                cancellationOutcome: CancellationOutcome.FREE,
            } as AppointmentEntity;

            appointmentRepository.findOne.mockResolvedValue(mockAppointment);

            const result = await useCase.execute(userId, appointmentId);

            expect(result).toEqual({
                appointmentId,
                bookingPrice: 250.0,
                cancellationOutcome: CancellationOutcome.FREE,
                total: 0,
                currency: 'EGP',
            });
        });

        it('should return full price when cancellation outcome is NO_REFUND', async () => {
            const mockAppointment = {
                id: appointmentId,
                patientId: userId,
                status: AppointmentStatus.CANCELLED,
                snapshotConsultationFee: 300.0,
                cancellationOutcome: CancellationOutcome.NO_REFUND,
            } as AppointmentEntity;

            appointmentRepository.findOne.mockResolvedValue(mockAppointment);

            const result = await useCase.execute(userId, appointmentId);

            expect(result).toEqual({
                appointmentId,
                bookingPrice: 300.0,
                cancellationOutcome: CancellationOutcome.NO_REFUND,
                total: 300.0,
                currency: 'EGP',
            });
        });
    });
});