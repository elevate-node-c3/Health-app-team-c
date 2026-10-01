import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as Stripe from 'stripe';
import { HandleStripeWebhookUseCase } from './handle-stripe-webhook.use-case';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHoldEntity, SlotHoldStatus } from 'src/modules/booking/entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

jest.mock('src/modules/booking/helpers/create-appointment-from-hold', () => ({
    createAppointmentFromHold: jest.fn().mockResolvedValue({ id: 'app-999' }),
}));

describe('HandleStripeWebhookUseCase', () => {
    let useCase: HandleStripeWebhookUseCase;
    let dataSource: any;
    let mockEntityManager: any;

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
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HandleStripeWebhookUseCase,
                {
                    provide: DataSource,
                    useValue: dataSource,
                },
            ],
        }).compile();

        useCase = module.get<HandleStripeWebhookUseCase>(HandleStripeWebhookUseCase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('execute', () => {
        it('should ignore unhandled event types and return { received: true }', async () => {
            const event = { type: 'customer.created', data: { object: {} } } as Stripe.Event;

            const result = await useCase.execute(event);

            expect(result).toEqual({ received: true });
            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        describe('processSuccessfulPayment', () => {
            it('should warn and exit if no transaction is found', async () => {
                const event = {
                    type: 'payment_intent.succeeded',
                    data: {
                        object: {
                            id: 'pi_123',
                            metadata: { idempotencyKey: 'PAY-123' },
                        },
                    },
                } as unknown as Stripe.Event;

                mockEntityManager.getRepository.mockImplementation((entity) => {
                    if (entity === PaymentTransaction) {
                        return { createQueryBuilder: () => createQueryBuilderMock(null) };
                    }
                });

                const result = await useCase.execute(event);

                expect(result).toEqual({ received: true });
            });

            it('should skip processing if transaction is already SUCCESS', async () => {
                const event = {
                    type: 'payment_intent.succeeded',
                    data: {
                        object: {
                            id: 'pi_123',
                        },
                    },
                } as unknown as Stripe.Event;

                mockEntityManager.getRepository.mockImplementation((entity) => {
                    if (entity === PaymentTransaction) {
                        return {
                            createQueryBuilder: () =>
                                createQueryBuilderMock({ id: 'tx-1', status: PaymentStatus.SUCCESS }),
                        };
                    }
                });

                const result = await useCase.execute(event);

                expect(result).toEqual({ received: true });
            });

            it('should mark transaction as REQUIRES_RECONCILIATION if hold is missing or invalid', async () => {
                const event = {
                    type: 'payment_intent.succeeded',
                    data: {
                        object: {
                            id: 'pi_123',
                            metadata: { idempotencyKey: 'PAY-123' },
                        },
                    },
                } as unknown as Stripe.Event;

                const mockTx = { id: 'tx-123', holdId: 'hold-123', status: PaymentStatus.PENDING };
                const updatePaymentMock = jest.fn().mockResolvedValue({});

                mockEntityManager.getRepository.mockImplementation((entity) => {
                    if (entity === PaymentTransaction) {
                        return {
                            createQueryBuilder: () => createQueryBuilderMock(mockTx),
                            update: updatePaymentMock,
                        };
                    }
                    if (entity === SlotHoldEntity) {
                        return {
                            createQueryBuilder: () => createQueryBuilderMock(null), // Hold not found
                        };
                    }
                });

                await useCase.execute(event);

                expect(updatePaymentMock).toHaveBeenCalledWith('tx-123', {
                    status: PaymentStatus.REQUIRES_RECONCILIATION,
                    providerReference: 'pi_123',
                    failureReason: 'Charged but hold not active',
                });
            });

            it('should process payment successfully and create appointment when hold is ACTIVE', async () => {
                const event = {
                    type: 'payment_intent.succeeded',
                    data: {
                        object: {
                            id: 'pi_123',
                            metadata: { idempotencyKey: 'PAY-123' },
                        },
                    },
                } as unknown as Stripe.Event;

                const mockTx = {
                    id: 'tx-123',
                    userId: 'user-1',
                    holdId: 'hold-123',
                    amount: '100',
                    status: PaymentStatus.PENDING,
                };
                const mockHold = {
                    id: 'hold-123',
                    status: SlotHoldStatus.ACTIVE,
                    patientId: 'patient-1',
                    doctorId: 'doc-1',
                    clinicId: 'clinic-1',
                    date: '2026-10-02',
                    startTime: '10:00',
                    endTime: '10:30',
                };

                const savePaymentMock = jest.fn().mockResolvedValue({});
                const saveOutboxMock = jest.fn().mockResolvedValue({});
                const updateHoldMock = jest.fn().mockResolvedValue({});

                mockEntityManager.getRepository.mockImplementation((entity) => {
                    if (entity === PaymentTransaction) {
                        return {
                            createQueryBuilder: () => createQueryBuilderMock(mockTx),
                            save: savePaymentMock,
                        };
                    }
                    if (entity === SlotHoldEntity) {
                        return {
                            createQueryBuilder: () => createQueryBuilderMock(mockHold),
                            update: updateHoldMock,
                        };
                    }
                    if (entity === OutboxEventEntity) {
                        return { save: saveOutboxMock };
                    }
                });

                await useCase.execute(event);

                expect(savePaymentMock).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: PaymentStatus.SUCCESS,
                        providerReference: 'pi_123',
                    }),
                );
                expect(updateHoldMock).toHaveBeenCalledWith('hold-123', {
                    status: SlotHoldStatus.CONSUMED,
                });
                expect(saveOutboxMock).toHaveBeenCalledTimes(2);
            });
        });

        describe('processFailedPayment', () => {
            it('should handle failed payment intent and release hold if ACTIVE', async () => {
                const event = {
                    type: 'payment_intent.payment_failed',
                    data: {
                        object: {
                            id: 'pi_failed_123',
                            last_payment_error: { message: 'Card declined' },
                        },
                    },
                } as unknown as Stripe.Event;

                const mockTx = {
                    id: 'tx-123',
                    userId: 'user-1',
                    holdId: 'hold-123',
                    status: PaymentStatus.PENDING,
                };

                const savePaymentMock = jest.fn().mockResolvedValue({});
                const saveOutboxMock = jest.fn().mockResolvedValue({});
                const updateHoldMock = jest.fn().mockResolvedValue({ affected: 1 });

                mockEntityManager.getRepository.mockImplementation((entity) => {
                    if (entity === PaymentTransaction) {
                        return {
                            createQueryBuilder: () => createQueryBuilderMock(mockTx),
                            save: savePaymentMock,
                        };
                    }
                    if (entity === SlotHoldEntity) {
                        return { update: updateHoldMock };
                    }
                    if (entity === OutboxEventEntity) {
                        return { save: saveOutboxMock };
                    }
                });

                await useCase.execute(event);

                expect(savePaymentMock).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: PaymentStatus.FAILED,
                        failureReason: 'Card declined',
                    }),
                );
                expect(updateHoldMock).toHaveBeenCalledWith(
                    { id: 'hold-123', status: SlotHoldStatus.ACTIVE },
                    { status: SlotHoldStatus.EXPIRED },
                );
                expect(saveOutboxMock).toHaveBeenCalledWith(
                    expect.objectContaining({
                        eventType: 'PAYMENT_FAILED',
                        aggregateId: 'tx-123',
                    }),
                );
            });
        });
    });
});