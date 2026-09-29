import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { ProcessPaymentUseCase } from './process-payment.use-case';
import { StripeService } from '../services/stripe.service';
import { SavedCard } from '../entities/saved-card.entity';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHold } from '../entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { ProcessPaymentDto } from '../dto/process-payment.dto';

describe('ProcessPaymentUseCase', () => {
    let useCase: ProcessPaymentUseCase;
    let stripeService: jest.Mocked<StripeService>;
    let savedCardRepo: jest.Mocked<Repository<SavedCard>>;
    let dataSource: jest.Mocked<DataSource>;

    const mockEntityManager = {
        getRepository: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;
    const mockPaymentRepo = {
        createQueryBuilder: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
    };

    const mockHoldRepo = {
        createQueryBuilder: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
    };

    const mockDoctorRepo = {
        findOne: jest.fn(),
    };

    const mockOutboxRepo = {
        save: jest.fn(),
    };

    const mockTxCardRepo = {
        findOne: jest.fn(),
        softDelete: jest.fn(),
    };

    const mockPaymentQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
    };

    const mockHoldQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
    };

    const mockUserId = 'user-uuid-123';
    const mockDto: ProcessPaymentDto = {
        holdId: 'hold-123',
        paymentMethodToken: 'pm_tok_123',
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProcessPaymentUseCase,
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
                {
                    provide: DataSource,
                    useValue: {
                        transaction: jest.fn().mockImplementation((cb) => cb(mockEntityManager)),
                        getRepository: jest.fn().mockReturnValue({
                            update: jest.fn(),
                        }),
                    },
                },
            ],
        }).compile();

        useCase = module.get<ProcessPaymentUseCase>(ProcessPaymentUseCase);
        stripeService = module.get(StripeService);
        savedCardRepo = module.get(getRepositoryToken(SavedCard));
        dataSource = module.get(DataSource);

        jest.clearAllMocks();

        mockPaymentRepo.createQueryBuilder.mockReturnValue(mockPaymentQueryBuilder);
        mockHoldRepo.createQueryBuilder.mockReturnValue(mockHoldQueryBuilder);

        (mockEntityManager.getRepository as jest.Mock).mockImplementation((entity) => {
            if (entity === PaymentTransaction) return mockPaymentRepo;
            if (entity === SlotHold) return mockHoldRepo;
            if (entity === DoctorEntity) return mockDoctorRepo;
            if (entity === OutboxEventEntity) return mockOutboxRepo;
            if (entity === SavedCard) return mockTxCardRepo;
            return null;
        });
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    describe('execute - Initial Validations', () => {
        it('should throw BadRequestException if neither paymentMethodToken nor cardId is provided', async () => {
            await expect(useCase.execute(mockUserId, { holdId: 'hold-1' })).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should throw NotFoundException if saved cardId does not exist', async () => {
            savedCardRepo.findOne.mockResolvedValue(null);

            await expect(
                useCase.execute(mockUserId, { holdId: 'hold-1', cardId: 'card-missing' }),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException if saved card is expired', async () => {
            const mockCard = {
                id: 'card-1',
                isExpired: jest.fn().mockReturnValue(true),
            } as unknown as SavedCard;

            savedCardRepo.findOne.mockResolvedValue(mockCard);

            await expect(
                useCase.execute(mockUserId, { holdId: 'hold-1', cardId: 'card-1' }),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('preparePaymentIntent', () => {
        it('should return alreadySucceeded response if transaction was previously SUCCESS', async () => {
            mockPaymentQueryBuilder.getOne.mockResolvedValue({
                id: 'tx-1',
                status: PaymentStatus.SUCCESS,
            });

            const result = await useCase.execute(mockUserId, mockDto);

            expect(result).toEqual({
                status: 'DONE',
                message: 'Your appointment has been booked successfully',
                details: {
                    instruction: 'We will remind you, Please arrive 15 minutes before the appointment.',
                },
            });
            expect(stripeService.chargeCard).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException if hold is not found', async () => {
            mockPaymentQueryBuilder.getOne.mockResolvedValue(null);
            mockHoldQueryBuilder.getOne.mockResolvedValue(null);

            await expect(useCase.execute(mockUserId, mockDto)).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException if hold is expired', async () => {
            mockPaymentQueryBuilder.getOne.mockResolvedValue(null);
            mockHoldQueryBuilder.getOne.mockResolvedValue({
                id: 'hold-123',
                expiresAt: new Date(Date.now() - 10000), // منتهي الصلاحية
            });

            await expect(useCase.execute(mockUserId, mockDto)).rejects.toThrow(BadRequestException);
        });

        it('should delete hold and throw BadRequestException if doctor is inactive or not found', async () => {
            mockPaymentQueryBuilder.getOne.mockResolvedValue(null);
            mockHoldQueryBuilder.getOne.mockResolvedValue({
                id: 'hold-123',
                doctorId: 'doc-1',
                expiresAt: new Date(Date.now() + 10000),
            });
            mockDoctorRepo.findOne.mockResolvedValue(null);

            await expect(useCase.execute(mockUserId, mockDto)).rejects.toThrow(BadRequestException);
            expect(mockHoldRepo.delete).toHaveBeenCalledWith('hold-123');
        });

        it('should throw ConflictException if slot hold is already consumed', async () => {
            mockPaymentQueryBuilder.getOne.mockResolvedValue(null);
            mockHoldQueryBuilder.getOne.mockResolvedValue({
                id: 'hold-123',
                doctorId: 'doc-1',
                expiresAt: new Date(Date.now() + 10000),
                isConsumed: true,
            });
            mockDoctorRepo.findOne.mockResolvedValue({ id: 'doc-1', isActive: true });

            await expect(useCase.execute(mockUserId, mockDto)).rejects.toThrow(ConflictException);
        });
    });

    describe('Stripe Charge & Finalization', () => {
        let mockHold: {
            id: string;
            doctorId: string;
            slotId: string;
            frozenPrice: number;
            expiresAt: Date;
            isConsumed: boolean;
        };

        let mockTx: {
            id: string;
            idempotencyKey: string;
            status: PaymentStatus;
            providerReference?: string;
        };

        beforeEach(() => {
            mockHold = {
                id: 'hold-123',
                doctorId: 'doc-1',
                slotId: 'slot-1',
                frozenPrice: 200,
                expiresAt: new Date(Date.now() + 10000),
                isConsumed: false,
            };

            mockTx = {
                id: 'tx-123',
                idempotencyKey: 'PAY-hold-123-user-uuid-123',
                status: PaymentStatus.PENDING,
            };

            mockPaymentQueryBuilder.getOne.mockResolvedValue(null);
            mockHoldQueryBuilder.getOne.mockResolvedValue(mockHold);
            mockDoctorRepo.findOne.mockResolvedValue({ id: 'doc-1', isActive: true });
            mockPaymentRepo.create.mockReturnValue(mockTx);
            mockPaymentRepo.save.mockResolvedValue(mockTx);
        });

        it('should handle Stripe API/Network failure and set status to REQUIRES_RECONCILIATION', async () => {
            stripeService.chargeCard.mockRejectedValue(new Error('Stripe Down'));

            await expect(useCase.execute(mockUserId, mockDto)).rejects.toThrow(
                InternalServerErrorException,
            );

            expect(dataSource.getRepository(PaymentTransaction).update).toHaveBeenCalledWith('tx-123', {
                status: PaymentStatus.REQUIRES_RECONCILIATION,
                failureReason: 'Payment provider unreachable or timed out',
            });
        });

        it('should handle payment failure and soft delete card if token is invalid', async () => {
            const dtoWithCard = { ...mockDto, cardId: 'card-abc' };

            stripeService.chargeCard.mockResolvedValue({
                isSuccess: false,
                transactionReference: undefined,
                failureReason: 'Card Declined',
                isTokenInvalid: true,
            });

            mockTxCardRepo.findOne.mockResolvedValue({
                id: 'card-abc',
                last4Digits: '4242',
            });

            await expect(useCase.execute(mockUserId, dtoWithCard)).rejects.toThrow(
                BadRequestException,
            );

            expect(mockPaymentRepo.update).toHaveBeenCalledWith('tx-123', {
                status: PaymentStatus.FAILED,
                failureReason: 'Card Declined',
            });
            expect(mockHoldRepo.delete).toHaveBeenCalledWith('hold-123');

            expect(mockTxCardRepo.softDelete).toHaveBeenCalledWith('card-abc');
            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'PAYMENT_METHOD',
                    eventType: 'PAYMENT_METHOD_REMOVED',
                }),
            );
        });

        it('should process payment successfully and save outbox events (Happy Path)', async () => {
            stripeService.chargeCard.mockResolvedValue({
                isSuccess: true,
                transactionReference: 'ch_stripe_ref_123',
                failureReason: undefined,
                isTokenInvalid: false,
            });

            mockPaymentQueryBuilder.getOne.mockResolvedValueOnce(null).mockResolvedValueOnce(mockTx);

            const result = await useCase.execute(mockUserId, mockDto);

            expect(stripeService.chargeCard).toHaveBeenCalledWith({
                amount: 200,
                currency: 'egp',
                paymentMethodId: 'pm_tok_123',
                idempotencyKey: 'PAY-hold-123-user-uuid-123',
            });

            expect(mockPaymentRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: PaymentStatus.SUCCESS,
                    providerReference: 'ch_stripe_ref_123',
                }),
            );

            expect(mockHoldRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    isConsumed: true,
                }),
            );

            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'PAYMENT',
                    eventType: 'PAYMENT_SUCCEEDED',
                }),
            );

            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'APPOINTMENT',
                    eventType: 'APPOINTMENT_BOOKED',
                }),
            );

            expect(result).toEqual({
                status: 'DONE',
                message: 'Your appointment has been booked successfully',
                details: {
                    instruction: 'We will remind you, Please arrive 15 minutes before the appointment.',
                },
            });
        });

        it('should set status to REQUIRES_RECONCILIATION if finalizing payment fails unexpectedly', async () => {
            stripeService.chargeCard.mockResolvedValue({
                isSuccess: true,
                transactionReference: 'ch_stripe_ref_123',
                failureReason: undefined,
                isTokenInvalid: false,
            });

            mockPaymentQueryBuilder.getOne
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(mockTx);


            mockPaymentRepo.save
                .mockResolvedValueOnce(mockTx)
                .mockImplementationOnce(() => {
                    throw new Error('Database transaction write failed during finalization');
                });

            await expect(useCase.execute(mockUserId, mockDto)).rejects.toThrow(
                InternalServerErrorException,
            );

            expect(dataSource.getRepository(PaymentTransaction).update).toHaveBeenCalledWith('tx-123', {
                status: PaymentStatus.REQUIRES_RECONCILIATION,
            });
        });
    });
});