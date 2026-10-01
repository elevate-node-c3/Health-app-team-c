import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcessPaymentUseCase } from './process-payment.use-case';
import { StripeService } from '../services/stripe.service';
import { SavedCard } from '../entities/saved-card.entity';
import { PaymentStatus, PaymentTransaction } from '../entities/payment-transaction.entity';
import { SlotHoldEntity, SlotHoldStatus } from 'src/modules/booking/entities/slot-hold.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { ProcessPaymentDto } from '../dto/process-payment.dto';

jest.mock('src/modules/booking/helpers/create-appointment-from-hold', () => ({
    createAppointmentFromHold: jest.fn().mockResolvedValue({ id: 'app-123' }),
}));

describe('ProcessPaymentUseCase', () => {
    let useCase: ProcessPaymentUseCase;
    let stripeService: jest.Mocked<StripeService>;
    let savedCardRepo: any;
    let dataSource: any;
    let mockEntityManager: any;

    const mockUserId = 'user-123';
    const mockHoldId = 'hold-123';
    const mockCardId = 'card-123';

    const createQueryBuilderMock = (result: any) => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(result),
    });

    beforeEach(async () => {
        mockEntityManager = {
            getRepository: jest.fn(),
            save: jest.fn(),
        };

        dataSource = {
            transaction: jest.fn((cb) => cb(mockEntityManager)),
            getRepository: jest.fn().mockReturnValue({
                update: jest.fn().mockResolvedValue({}),
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProcessPaymentUseCase,
                {
                    provide: DataSource,
                    useValue: dataSource,
                },
                {
                    provide: StripeService,
                    useValue: {
                        chargeCard: jest.fn(),
                    },
                },
                {
                    provide: getRepositoryToken(SavedCard),
                    useValue: {
                        findOne: jest.fn(),
                    },
                },
            ],
        }).compile();

        useCase = module.get<ProcessPaymentUseCase>(ProcessPaymentUseCase);
        stripeService = module.get(StripeService);
        savedCardRepo = module.get(getRepositoryToken(SavedCard));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('execute', () => {
        it('should throw NotFoundException if saved card is not found', async () => {
            savedCardRepo.findOne.mockResolvedValue(null);

            const dto: ProcessPaymentDto = { holdId: mockHoldId, cardId: mockCardId };

            await expect(useCase.execute(mockUserId, dto)).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException if saved card is expired', async () => {
            savedCardRepo.findOne.mockResolvedValue({
                id: mockCardId,
                userId: mockUserId,
                isExpired: () => true,
            });

            const dto: ProcessPaymentDto = { holdId: mockHoldId, cardId: mockCardId };

            await expect(useCase.execute(mockUserId, dto)).rejects.toThrow(
                new BadRequestException('The selected card is expired'),
            );
        });

        it('should throw BadRequestException if neither paymentMethodToken nor cardId is provided', async () => {
            const dto: ProcessPaymentDto = { holdId: mockHoldId };

            await expect(useCase.execute(mockUserId, dto)).rejects.toThrow(
                new BadRequestException('Payment method or card reference is required'),
            );
        });

        it('should return immediate success response if transaction already succeeded', async () => {
            const dto: ProcessPaymentDto = { holdId: mockHoldId, paymentMethodToken: 'tok_123' };

            mockEntityManager.getRepository.mockImplementation((entity) => {
                if (entity === PaymentTransaction) {
                    return {
                        createQueryBuilder: () =>
                            createQueryBuilderMock({ status: PaymentStatus.SUCCESS }),
                    };
                }
            });

            const result = await useCase.execute(mockUserId, dto);

            expect(result.status).toBe('DONE');
            expect(stripeService.chargeCard).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException if doctor is inactive', async () => {
            const dto: ProcessPaymentDto = { holdId: mockHoldId, paymentMethodToken: 'tok_123' };
            const mockHold = { id: mockHoldId, doctorId: 'doc-1', expiresAt: new Date(Date.now() + 10000) };

            mockEntityManager.getRepository.mockImplementation((entity) => {
                if (entity === PaymentTransaction) {
                    return { createQueryBuilder: () => createQueryBuilderMock(null) };
                }
                if (entity === SlotHoldEntity) {
                    return {
                        createQueryBuilder: () => createQueryBuilderMock(mockHold),
                        update: jest.fn().mockResolvedValue({}),
                    };
                }
                if (entity === DoctorEntity) {
                    return { findOne: jest.fn().mockResolvedValue({ id: 'doc-1', isActive: false }) };
                }
            });

            await expect(useCase.execute(mockUserId, dto)).rejects.toThrow(
                new BadRequestException(
                    'This doctor is no longer available for appointments. Please choose another time or doctor.',
                ),
            );
        });

        it('should handle Stripe communication failure and throw InternalServerErrorException', async () => {
            const dto: ProcessPaymentDto = { holdId: mockHoldId, paymentMethodToken: 'tok_123' };
            const mockHold = { id: mockHoldId, frozenFee: '100', expiresAt: new Date(Date.now() + 10000) };
            const mockTx = { id: 'tx-123', idempotencyKey: 'PAY-hold-123-user-123' };

            mockEntityManager.getRepository.mockImplementation((entity) => {
                if (entity === PaymentTransaction) {
                    return {
                        createQueryBuilder: () => createQueryBuilderMock(null),
                        create: jest.fn().mockReturnValue(mockTx),
                        save: jest.fn().mockResolvedValue(mockTx),
                        update: jest.fn().mockResolvedValue({}),
                    };
                }
                if (entity === SlotHoldEntity) {
                    return { createQueryBuilder: () => createQueryBuilderMock(mockHold) };
                }
                if (entity === DoctorEntity) {
                    return { findOne: jest.fn().mockResolvedValue({ id: 'doc-1', isActive: true }) };
                }
            });

            stripeService.chargeCard.mockRejectedValue(new Error('Stripe timeout'));

            await expect(useCase.execute(mockUserId, dto)).rejects.toThrow(
                InternalServerErrorException,
            );

            expect(dataSource.getRepository(PaymentTransaction).update).toHaveBeenCalledWith(
                'tx-123',
                expect.objectContaining({
                    status: PaymentStatus.REQUIRES_RECONCILIATION,
                }),
            );
        });

        it('should handle payment failure when Stripe rejects card and call handleFailure', async () => {
            const dto: ProcessPaymentDto = {
                holdId: mockHoldId,
                cardId: mockCardId,
            };

            savedCardRepo.findOne.mockResolvedValue({
                id: mockCardId,
                userId: mockUserId,
                isExpired: () => false,
                providerCardToken: 'tok_saved',
            });

            const mockHold = { id: mockHoldId, frozenFee: '100', expiresAt: new Date(Date.now() + 10000) };
            const mockTx = { id: 'tx-123' };

            mockEntityManager.getRepository.mockImplementation((entity) => {
                if (entity === PaymentTransaction) {
                    return {
                        createQueryBuilder: () => createQueryBuilderMock(null),
                        create: jest.fn().mockReturnValue(mockTx),
                        save: jest.fn().mockResolvedValue(mockTx),
                        update: jest.fn().mockResolvedValue({}),
                    };
                }
                if (entity === SlotHoldEntity) {
                    return {
                        createQueryBuilder: () => createQueryBuilderMock(mockHold),
                        update: jest.fn().mockResolvedValue({}),
                    };
                }
                if (entity === DoctorEntity) {
                    return { findOne: jest.fn().mockResolvedValue({ id: 'doc-1', isActive: true }) };
                }
                if (entity === SavedCard) {
                    return {
                        findOne: jest.fn().mockResolvedValue({ id: mockCardId, last4Digits: '4242' }),
                        softDelete: jest.fn().mockResolvedValue({}),
                    };
                }
                return { save: jest.fn().mockResolvedValue({}) };
            });

            stripeService.chargeCard.mockResolvedValue({
                isSuccess: false,
                failureReason: 'Invalid token',
                isTokenInvalid: true,
                transactionReference: undefined,
            });

            await expect(useCase.execute(mockUserId, dto)).rejects.toThrow(
                new BadRequestException('This saved card is no longer valid. Please add it again.'),
            );
        });

        it('should process payment successfully and create outbox events and appointment', async () => {
            const dto: ProcessPaymentDto = { holdId: mockHoldId, paymentMethodToken: 'tok_123' };
            const mockHold = {
                id: mockHoldId,
                frozenFee: '150',
                status: SlotHoldStatus.ACTIVE,
                expiresAt: new Date(Date.now() + 10000),
                patientId: mockUserId,
                doctorId: 'doc-1',
                clinicId: 'clinic-1',
                date: '2026-10-02',
                startTime: '10:00',
                endTime: '10:30',
            };
            const mockTx = {
                id: 'tx-123',
                status: PaymentStatus.PENDING,
                idempotencyKey: `PAY-${mockHoldId}-${mockUserId}`
            };

            const outboxSaveMock = jest.fn().mockResolvedValue({});

            mockEntityManager.getRepository.mockImplementation((entity) => {
                if (entity === PaymentTransaction) {
                    return {
                        createQueryBuilder: () => createQueryBuilderMock(mockTx),
                        create: jest.fn().mockReturnValue(mockTx),
                        save: jest.fn().mockResolvedValue(mockTx),
                        update: jest.fn().mockResolvedValue({}),
                    };
                }
                if (entity === SlotHoldEntity) {
                    return {
                        createQueryBuilder: () => createQueryBuilderMock(mockHold),
                        update: jest.fn().mockResolvedValue({}),
                    };
                }
                if (entity === DoctorEntity) {
                    return { findOne: jest.fn().mockResolvedValue({ id: 'doc-1', isActive: true }) };
                }
                if (entity === OutboxEventEntity) {
                    return { save: outboxSaveMock };
                }
                return { save: jest.fn().mockResolvedValue({}) };
            });

            stripeService.chargeCard.mockResolvedValue({
                isSuccess: true,
                transactionReference: 'ch_stripe_ref_123',
                failureReason: undefined,
                isTokenInvalid: false,
            });

            const response = await useCase.execute(mockUserId, dto);

            expect(response.status).toBe('DONE');
            expect(response.message).toContain('booked successfully');
            expect(outboxSaveMock).toHaveBeenCalledTimes(2);
        });
    });
});