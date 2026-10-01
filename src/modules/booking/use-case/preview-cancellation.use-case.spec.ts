import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PreviewCancellationUseCase } from './preview-cancellation.use-case';
import {
    AppointmentEntity,
    AppointmentStatus,
    CancellationOutcome,
} from 'src/modules/catalog/entities/appointment.entity';

describe('PreviewCancellationUseCase', () => {
    let useCase: PreviewCancellationUseCase;
    let appointmentRepo: jest.Mocked<Repository<AppointmentEntity>>;

    const mockAppointmentId = 'app-123';
    const mockPatientId = 'patient-123';
    const mockFee = 250;

    const createFutureDate = (hoursInFuture: number): Date => {
        const d = new Date();
        d.setHours(d.getHours() + hoursInFuture);
        return d;
    };

    const createPastDate = (hoursInPast: number): Date => {
        const d = new Date();
        d.setHours(d.getHours() - hoursInPast);
        return d;
    };

    beforeEach(async () => {
        const mockRepository = {
            findOne: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PreviewCancellationUseCase,
                {
                    provide: getRepositoryToken(AppointmentEntity),
                    useValue: mockRepository,
                },
            ],
        }).compile();

        useCase = module.get<PreviewCancellationUseCase>(PreviewCancellationUseCase);
        appointmentRepo = module.get(getRepositoryToken(AppointmentEntity));
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    describe('execute', () => {
        it('should throw NotFoundException if appointment does not exist', async () => {
            appointmentRepo.findOne.mockResolvedValue(null);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw NotFoundException if appointment belongs to another patient', async () => {
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: 'another-patient-456',
            } as AppointmentEntity);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException if appointment status is CANCELLED', async () => {
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.CANCELLED,
            } as AppointmentEntity);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException if appointment status is COMPLETED', async () => {
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.COMPLETED,
            } as AppointmentEntity);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException if appointment has already started', async () => {
            const pastTime = createPastDate(1);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                date: pastTime.toISOString().split('T')[0],
                startTime: pastTime.toTimeString().split(' ')[0],
            } as AppointmentEntity);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should return FREE outcome with full refund when cancelled > 24 hours in advance', async () => {
            const futureTime = createFutureDate(48);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                snapshotConsultationFee: mockFee,
                date: futureTime.toISOString().split('T')[0],
                startTime: futureTime.toTimeString().split(' ')[0],
            } as AppointmentEntity);

            const result = await useCase.execute(mockAppointmentId, mockPatientId);

            expect(result).toEqual({
                appointmentId: mockAppointmentId,
                outcome: CancellationOutcome.FREE,
                refundAmount: mockFee,
                feeAmount: 0,
                message: 'No fees will be charged!',
            });
        });

        it('should return NO_REFUND outcome when cancelled within 24 hours', async () => {
            const futureTime = createFutureDate(5);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                snapshotConsultationFee: mockFee,
                date: futureTime.toISOString().split('T')[0],
                startTime: futureTime.toTimeString().split(' ')[0],
            } as AppointmentEntity);

            const result = await useCase.execute(mockAppointmentId, mockPatientId);

            expect(result).toEqual({
                appointmentId: mockAppointmentId,
                outcome: CancellationOutcome.NO_REFUND,
                refundAmount: 0,
                feeAmount: mockFee,
                message: 'No refund available if you cancel now!',
            });
        });

        it('should default snapshotConsultationFee to 0 if null/undefined', async () => {
            const futureTime = createFutureDate(48);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                snapshotConsultationFee: null,
                date: futureTime.toISOString().split('T')[0],
                startTime: futureTime.toTimeString().split(' ')[0],
            } as unknown as AppointmentEntity);

            const result = await useCase.execute(mockAppointmentId, mockPatientId);

            expect(result.refundAmount).toBe(0);
            expect(result.feeAmount).toBe(0);
        });
    });
});