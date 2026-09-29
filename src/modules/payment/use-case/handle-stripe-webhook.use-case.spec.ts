import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import * as Stripe from 'stripe';

import { HandleStripeWebhookUseCase } from './handle-stripe-webhook.use-case';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHoldEntity, SlotHoldStatus } from 'src/modules/booking/entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

describe('HandleStripeWebhookUseCase', () => {
    let useCase: HandleStripeWebhookUseCase;
    let dataSource: jest.Mocked<DataSource>;

    const mockEntityManager = {
        getRepository: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    const mockPaymentRepo = {
        createQueryBuilder: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
    };

    const mockHoldRepo = {
        createQueryBuilder: jest.fn(),
        update: jest.fn(),
    };

    const mockOutboxRepo = {
        save: jest.fn(),
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

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HandleStripeWebhookUseCase,
                {
                    provide: DataSource,
                    useValue: {
                        transaction: jest.fn().mockImplementation((cb) => cb(mockEntityManager)),
                    },
                },
            ],
        }).compile();

        useCase = module.get<HandleStripeWebhookUseCase>(HandleStripeWebhookUseCase);
        dataSource = module.get(DataSource);

        jest.clearAllMocks();

        mockPaymentRepo.createQueryBuilder.mockReturnValue(mockPaymentQueryBuilder);
        mockHoldRepo.createQueryBuilder.mockReturnValue(mockHoldQueryBuilder);

        (mockEntityManager.getRepository as jest.Mock).mockImplementation((entity) => {
            if (entity === PaymentTransaction) return mockPaymentRepo;
            if (entity === SlotHoldEntity) return mockHoldRepo;
            if (entity === OutboxEventEntity) return mockOutboxRepo;
            return null;
        });
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    describe('execute', () => {
        it('should ignore unhandled event types and return received: true', async () => {
            const event = {
                type: 'customer.created',
                data: { object: {} },
            } as Stripe.Event;

            const result = await useCase.execute(event);

            expect(result).toEqual({ received: true });
            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        describe('payment_intent.succeeded', () => {
            const mockPaymentIntent: Partial<Stripe.PaymentIntent> = {
                id: 'pi_12345',
                metadata: { idempotencyKey: 'idemp-key-123' },
            };

            const event = {
                type: 'payment_intent.succeeded',
                data: { object: mockPaymentIntent },
            } as Stripe.Event;

            it('should search transaction by idempotencyKey if present', async () => {
                mockPaymentQueryBuilder.getOne.mockResolvedValue(null);

                await useCase.execute(event);

                expect(mockPaymentQueryBuilder.where).toHaveBeenCalledWith(
                    'tx.idempotencyKey = :idempotencyKey',
                    { idempotencyKey: 'idemp-key-123' },
                );
            });

            it('should search transaction by providerReference if idempotencyKey is missing', async () => {
                const eventWithoutIdempKey = {
                    type: 'payment_intent.succeeded',
                    data: { object: { id: 'pi_12345', metadata: {} } },
                } as Stripe.Event;

                mockPaymentQueryBuilder.getOne.mockResolvedValue(null);

                await useCase.execute(eventWithoutIdempKey);

                expect(mockPaymentQueryBuilder.where).toHaveBeenCalledWith(
                    'tx.providerReference = :stripeRef',
                    { stripeRef: 'pi_12345' },
                );
            });

            it('should return without changes if transaction is not found', async () => {
                mockPaymentQueryBuilder.getOne.mockResolvedValue(null);

                await useCase.execute(event);

                expect(mockPaymentRepo.save).not.toHaveBeenCalled();
                expect(mockOutboxRepo.save).not.toHaveBeenCalled();
            });

            it('should return without changes if transaction was already SUCCESS', async () => {
                mockPaymentQueryBuilder.getOne.mockResolvedValue({
                    id: 'tx-1',
                    status: PaymentStatus.SUCCESS,
                });

                await useCase.execute(event);

                expect(mockPaymentRepo.save).not.toHaveBeenCalled();
                expect(mockOutboxRepo.save).not.toHaveBeenCalled();
            });

            it('should process successful payment and book appointment when active hold is found', async () => {
                const mockPaymentTx = {
                    id: 'tx-123',
                    userId: 'user-1',
                    holdId: 'hold-1',
                    amount: 100,
                    status: PaymentStatus.PENDING,
                };

                const mockHold = {
                    id: 'hold-1',
                    patientId: 'patient-1',
                    doctorId: 'doc-88',
                    clinicId: 'clinic-1',
                    date: '2026-10-01',
                    startTime: '10:00',
                    endTime: '10:30',
                    status: SlotHoldStatus.ACTIVE,
                };

                mockPaymentQueryBuilder.getOne.mockResolvedValue(mockPaymentTx);
                mockHoldQueryBuilder.getOne.mockResolvedValue(mockHold);

                await useCase.execute(event);

                expect(mockPaymentRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: PaymentStatus.SUCCESS,
                        providerReference: 'pi_12345',
                    }),
                );

                expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        aggregateType: 'PAYMENT',
                        aggregateId: 'tx-123',
                        eventType: 'PAYMENT_SUCCEEDED',
                    }),
                );

                expect(mockHoldRepo.update).toHaveBeenCalledWith('hold-1', {
                    status: SlotHoldStatus.CONSUMED,
                });

                expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        aggregateType: 'APPOINTMENT',
                        aggregateId: 'hold-1',
                        eventType: 'APPOINTMENT_BOOKED',
                    }),
                );
            });

            it('should set status to REQUIRES_RECONCILIATION if hold is missing or invalid', async () => {
                const mockPaymentTx = {
                    id: 'tx-123',
                    userId: 'user-1',
                    holdId: 'hold-missing',
                    amount: 100,
                    status: PaymentStatus.PENDING,
                };

                mockPaymentQueryBuilder.getOne.mockResolvedValue(mockPaymentTx);
                mockHoldQueryBuilder.getOne.mockResolvedValue(null);

                await useCase.execute(event);

                expect(mockPaymentRepo.update).toHaveBeenCalledWith('tx-123', {
                    status: PaymentStatus.REQUIRES_RECONCILIATION,
                    providerReference: 'pi_12345',
                    failureReason: 'Charged but hold not active',
                });
            });
        });

        describe('payment_intent.payment_failed', () => {
            const mockPaymentIntentFailed: Partial<Stripe.PaymentIntent> = {
                id: 'pi_failed_123',
                metadata: { idempotencyKey: 'idemp-fail-123' },
                last_payment_error: {
                    message: 'Insufficient funds',
                } as any,
            };

            const event = {
                type: 'payment_intent.payment_failed',
                data: { object: mockPaymentIntentFailed },
            } as Stripe.Event;

            it('should process failed payment and expire hold', async () => {
                const mockPaymentTx = {
                    id: 'tx-failed-123',
                    userId: 'user-1',
                    holdId: 'hold-to-expire',
                    status: PaymentStatus.PENDING,
                };

                mockPaymentQueryBuilder.getOne.mockResolvedValue(mockPaymentTx);
                mockHoldRepo.update.mockResolvedValue({ affected: 1, raw: [] });

                await useCase.execute(event);

                expect(mockPaymentRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: PaymentStatus.FAILED,
                        failureReason: 'Insufficient funds',
                    }),
                );

                expect(mockHoldRepo.update).toHaveBeenCalledWith(
                    { id: 'hold-to-expire', status: SlotHoldStatus.ACTIVE },
                    { status: SlotHoldStatus.EXPIRED },
                );

                expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        aggregateType: 'PAYMENT',
                        aggregateId: 'tx-failed-123',
                        eventType: 'PAYMENT_FAILED',
                        payload: expect.objectContaining({
                            reason: 'Insufficient funds',
                        }),
                    }),
                );
            });

            it('should return without making changes if transaction is already SUCCESS', async () => {
                mockPaymentQueryBuilder.getOne.mockResolvedValue({
                    id: 'tx-123',
                    status: PaymentStatus.SUCCESS,
                });

                await useCase.execute(event);

                expect(mockPaymentRepo.save).not.toHaveBeenCalled();
                expect(mockHoldRepo.update).not.toHaveBeenCalled();
                expect(mockOutboxRepo.save).not.toHaveBeenCalled();
            });

            it('should use default message if last_payment_error is missing', async () => {
                const eventWithoutError = {
                    type: 'payment_intent.payment_failed',
                    data: { object: { id: 'pi_123' } },
                } as Stripe.Event;

                const mockPaymentTx = {
                    id: 'tx-123',
                    holdId: 'hold-1',
                    status: PaymentStatus.PENDING,
                };

                mockPaymentQueryBuilder.getOne.mockResolvedValue(mockPaymentTx);
                mockHoldRepo.update.mockResolvedValue({ affected: 0, raw: [] });

                await useCase.execute(eventWithoutError);

                expect(mockPaymentRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({
                        failureReason: 'Payment failed',
                    }),
                );
            });
        });
    });
});