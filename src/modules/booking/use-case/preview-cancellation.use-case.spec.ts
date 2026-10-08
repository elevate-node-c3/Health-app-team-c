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

    const createFutureDate = (hoursInFuture: number) => {
        const d = new Date();
        d.setHours(d.getHours() + hoursInFuture);
        // Format relative to local timezone rather than mixing UTC date and local time
        const pad = (n: number) => String(n).padStart(2, '0');
        const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const startTime = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return { date, startTime };
    };

    const createPastDate = (hoursInPast: number) => {
        return createFutureDate(-hoursInPast);
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
            const { date, startTime } = createPastDate(1);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                date: date,
                startTime: startTime,
            } as AppointmentEntity);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should return FREE outcome with full refund when cancelled > 24 hours in advance', async () => {
            const { date, startTime } = createFutureDate(48);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                snapshotConsultationFee: mockFee,
                date: date,
                startTime: startTime,
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
            const { date, startTime } = createFutureDate(5);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                snapshotConsultationFee: mockFee,
                date: date,
                startTime: startTime,
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
            const { date, startTime } = createFutureDate(48);
            appointmentRepo.findOne.mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                snapshotConsultationFee: null,
                date: date,
                startTime: startTime,
            } as unknown as AppointmentEntity);

            const result = await useCase.execute(mockAppointmentId, mockPatientId);

            expect(result.refundAmount).toBe(0);
            expect(result.feeAmount).toBe(0);
        });
    });
});