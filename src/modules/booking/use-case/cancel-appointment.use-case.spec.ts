import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CancelAppointmentUseCase } from './cancel-appointment.use-case';
import { RefundService } from 'src/modules/payment/services/refund.service';
import { AppointmentReminderService } from '../services/appointment-reminder.service';
import {
    AppointmentEntity,
    AppointmentStatus,
    CancellationOutcome,
} from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { RefundEntity } from 'src/modules/payment/entities/refund.entity';

describe('CancelAppointmentUseCase', () => {
    let useCase: CancelAppointmentUseCase;
    let dataSource: jest.Mocked<DataSource>;
    let refundService: jest.Mocked<RefundService>;
    let entityManager: jest.Mocked<EntityManager>;

    const mockAppointmentId = 'app-123';
    const mockPatientId = 'patient-123';
    const mockHoldId = 'hold-123';

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
        const mockQueryBuilder = {
            setLock: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
        };

        const mockRepository = {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
        };

        entityManager = {
            getRepository: jest.fn().mockReturnValue(mockRepository),
        } as unknown as jest.Mocked<EntityManager>;

        const mockDataSource = {
            transaction: jest.fn().mockImplementation(async (cb) => cb(entityManager)),
        };

        const mockRefundService = {
            createPendingRefund: jest.fn(),
            processRefund: jest.fn().mockResolvedValue(undefined),
        };

        const mockReminderService = {
            cancelForAppointment: jest.fn().mockResolvedValue(undefined),
            scheduleForBooking: jest.fn(),
            moveForReschedule: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CancelAppointmentUseCase,
                { provide: DataSource, useValue: mockDataSource },
                { provide: RefundService, useValue: mockRefundService },
                { provide: AppointmentReminderService, useValue: mockReminderService },
            ],
        }).compile();

        useCase = module.get<CancelAppointmentUseCase>(CancelAppointmentUseCase);
        dataSource = module.get(DataSource);
        refundService = module.get(RefundService);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    describe('execute', () => {
        it('should throw NotFoundException if appointment does not exist or patientId mismatches', async () => {
            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue(null);

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException if appointment is already cancelled', async () => {
            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.CANCELLED,
            });

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException if appointment is already completed', async () => {
            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.COMPLETED,
            });

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException if appointment has already started', async () => {
            const startDate = createPastDate(1);
            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                date: startDate.toISOString().split('T')[0],
                startTime: startDate.toTimeString().split(' ')[0],
            });

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw ConflictException if acknowledgedOutcome differs from actual outcome', async () => {
            const startDate = createFutureDate(48);
            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue({
                id: mockAppointmentId,
                patientId: mockPatientId,
                status: AppointmentStatus.BOOKED,
                date: startDate.toISOString().split('T')[0],
                startTime: startDate.toTimeString().split(' ')[0],
            });

            await expect(
                useCase.execute(
                    mockAppointmentId,
                    mockPatientId,
                    CancellationOutcome.NO_REFUND,
                ),
            ).rejects.toThrow(ConflictException);
        });

        it('should cancel successfully with FREE outcome and trigger async processRefund', async () => {
            const startDate = createFutureDate(48);
            const mockAppointment = {
                id: mockAppointmentId,
                patientId: mockPatientId,
                doctorId: 'doc-1',
                clinicId: 'clinic-1',
                holdId: mockHoldId,
                status: AppointmentStatus.BOOKED,
                date: startDate.toISOString().split('T')[0],
                startTime: startDate.toTimeString().split(' ')[0],
            };

            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue(mockAppointment);

            refundService.createPendingRefund.mockResolvedValue({
                id: 'refund-999',
            } as RefundEntity);

            const result = await useCase.execute(mockAppointmentId, mockPatientId);

            expect(result.outcome).toBe(CancellationOutcome.FREE);
            expect(result.refundStatus).toBe('PENDING');

            expect(refundService.createPendingRefund).toHaveBeenCalledWith(
                entityManager,
                { appointmentId: mockAppointmentId, holdId: mockHoldId },
            );

            expect(entityManager.getRepository(OutboxEventEntity).save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'APPOINTMENT',
                    eventType: 'APPOINTMENT_CANCELLED',
                }),
            );

            expect(refundService.processRefund).toHaveBeenCalledWith('refund-999');
        });

        it('should cancel with NO_REFUND outcome when inside 24 hours window without creating refund', async () => {
            const startDate = createFutureDate(5);
            const mockAppointment = {
                id: mockAppointmentId,
                patientId: mockPatientId,
                doctorId: 'doc-1',
                clinicId: 'clinic-1',
                holdId: mockHoldId,
                status: AppointmentStatus.BOOKED,
                date: startDate.toISOString().split('T')[0],
                startTime: startDate.toTimeString().split(' ')[0],
            };

            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue(mockAppointment);

            const result = await useCase.execute(mockAppointmentId, mockPatientId);

            expect(result.outcome).toBe(CancellationOutcome.NO_REFUND);
            expect(result.refundStatus).toBe('NOT_APPLICABLE');

            expect(refundService.createPendingRefund).not.toHaveBeenCalled();
            expect(refundService.processRefund).not.toHaveBeenCalled();
        });

        it('should handle background processRefund failure gracefully without throwing', async () => {
            const startDate = createFutureDate(48);
            const mockAppointment = {
                id: mockAppointmentId,
                patientId: mockPatientId,
                holdId: mockHoldId,
                status: AppointmentStatus.BOOKED,
                date: startDate.toISOString().split('T')[0],
                startTime: startDate.toTimeString().split(' ')[0],
            };

            const repo = entityManager.getRepository(AppointmentEntity);
            (repo.createQueryBuilder().getOne as jest.Mock).mockResolvedValue(mockAppointment);

            refundService.createPendingRefund.mockResolvedValue({
                id: 'refund-999',
            } as RefundEntity);

            refundService.processRefund.mockRejectedValueOnce(new Error('Stripe Down'));

            await expect(
                useCase.execute(mockAppointmentId, mockPatientId),
            ).resolves.toBeDefined();

            expect(refundService.processRefund).toHaveBeenCalledWith('refund-999');
        });
    });
});