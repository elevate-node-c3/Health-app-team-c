import {
    Injectable,
    BadRequestException,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProcessPaymentDto } from '../dto/process-payment.dto';
import { StripeService } from '../services/stripe.service';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { SlotHold } from '../entities/slot-hold.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { SavedCard } from '../entities/saved-card.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';

interface PreparedIntent {
    alreadySucceeded: boolean;
    response?: any;
    hold?: SlotHold;
    paymentTx?: PaymentTransaction;
}

interface FailureContext {
    isTokenInvalid?: boolean;
    cardId?: string;
    userId?: string;
}

@Injectable()
export class ProcessPaymentUseCase {
    constructor(
        private readonly dataSource: DataSource,
        private readonly stripeService: StripeService,
        @InjectRepository(SavedCard)
        private readonly savedCardRepo: Repository<SavedCard>,
    ) { }

    async execute(userId: string, dto: ProcessPaymentDto) {
        let tokenToCharge = dto.paymentMethodToken;

        if (!tokenToCharge && dto.cardId) {
            const savedCard = await this.savedCardRepo.findOne({
                where: { id: dto.cardId, userId },
            });

            if (!savedCard) {
                throw new NotFoundException('Saved card not found');
            }

            if (savedCard.isExpired()) {
                throw new BadRequestException('The selected card is expired');
            }

            tokenToCharge = savedCard.providerCardToken;
        }

        if (!tokenToCharge) {
            throw new BadRequestException('Payment method or card reference is required');
        }

        const prepared = await this.preparePaymentIntent(userId, dto);


        if (prepared.alreadySucceeded) {
            return prepared.response;
        }

        const { hold, paymentTx } = prepared as {
            hold: SlotHold;
            paymentTx: PaymentTransaction;
        };

        let stripeResult;
        try {
            stripeResult = await this.stripeService.chargeCard({
                amount: hold.frozenPrice,
                currency: 'egp',
                paymentMethodId: tokenToCharge,
                idempotencyKey: paymentTx.idempotencyKey,
            });
        } catch (err) {
            await this.dataSource.getRepository(PaymentTransaction).update(paymentTx.id, {
                status: PaymentStatus.REQUIRES_RECONCILIATION,
                failureReason: 'Payment provider unreachable or timed out',
            });
            throw new InternalServerErrorException(
                "We couldn't reach the payment provider. Please try again shortly.",
            );
        }

        if (!stripeResult.isSuccess) {
            await this.handleFailure(paymentTx.id, hold.id, stripeResult.failureReason, {
                isTokenInvalid: stripeResult.isTokenInvalid,
                cardId: dto.cardId,
                userId,
            });

            if (stripeResult.isTokenInvalid && dto.cardId) {
                throw new BadRequestException(
                    'This saved card is no longer valid. Please add it again.',
                );
            }

            throw new BadRequestException(
                "Payment Failed, We couldn't process your payment. Please check your card details",
            );
        }

        try {
            return await this.finalizePaymentAndOutbox(
                userId,
                hold,
                paymentTx.id,
                stripeResult.transactionReference || '',
            );
        } catch (error) {
            await this.dataSource.getRepository(PaymentTransaction).update(paymentTx.id, {
                status: PaymentStatus.REQUIRES_RECONCILIATION,
            });
            throw new InternalServerErrorException('Booking completion failed.');
        }
    }

    private async preparePaymentIntent(
        userId: string,
        dto: ProcessPaymentDto,
    ): Promise<PreparedIntent> {
        return await this.dataSource.transaction(async (manager: EntityManager) => {
            const holdRepo = manager.getRepository(SlotHold);
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const doctorRepo = manager.getRepository(DoctorEntity);

            const idempotencyKey = `PAY-${dto.holdId}-${userId}`;

            const existingTx = await paymentRepo
                .createQueryBuilder('tx')
                .setLock('pessimistic_write')
                .where('tx.idempotencyKey = :idempotencyKey', { idempotencyKey })
                .getOne();

            if (existingTx?.status === PaymentStatus.SUCCESS) {
                return {
                    alreadySucceeded: true,
                    response: {
                        status: 'DONE',
                        message: 'Your appointment has been booked successfully',
                        details: {
                            instruction:
                                'We will remind you, Please arrive 15 minutes before the appointment.',
                        },
                    },
                };
            }

            const hold = await holdRepo
                .createQueryBuilder('hold')
                .setLock('pessimistic_write')
                .where('hold.id = :holdId AND hold.userId = :userId', {
                    holdId: dto.holdId,
                    userId,
                })
                .getOne();

            if (!hold) throw new NotFoundException('Slot hold not found');
            if (new Date() > hold.expiresAt) throw new BadRequestException('Hold expired');

            const doctor = await doctorRepo.findOne({ where: { id: hold.doctorId } });
            if (!doctor || !doctor.isActive) {
                await holdRepo.delete(hold.id);
                throw new BadRequestException(
                    'This doctor is no longer available for appointments. Please choose another time or doctor.',
                );
            }


            if (hold.isConsumed && existingTx?.status !== PaymentStatus.PENDING) {
                throw new ConflictException('Slot already booked');
            }

            let paymentTx = existingTx;
            if (!paymentTx) {
                paymentTx = paymentRepo.create({
                    userId,
                    holdId: hold.id,
                    amount: hold.frozenPrice,
                    status: PaymentStatus.PENDING,
                    idempotencyKey,
                });
                await paymentRepo.save(paymentTx);
            }

            return { alreadySucceeded: false, hold, paymentTx };
        });
    }

    private async finalizePaymentAndOutbox(
        userId: string,
        hold: SlotHold,
        paymentTxId: string,
        stripeRef: string,
    ) {
        return await this.dataSource.transaction(async (manager: EntityManager) => {
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const outboxRepo = manager.getRepository(OutboxEventEntity);
            const holdRepo = manager.getRepository(SlotHold);

            const paymentTx = await paymentRepo
                .createQueryBuilder('tx')
                .setLock('pessimistic_write')
                .where('tx.id = :paymentTxId', { paymentTxId })
                .getOne();

            if (!paymentTx) throw new NotFoundException('Payment transaction not found');

            if (paymentTx.status !== PaymentStatus.SUCCESS) {
                paymentTx.status = PaymentStatus.SUCCESS;
                paymentTx.providerReference = stripeRef;
                await paymentRepo.save(paymentTx);

                hold.isConsumed = true;
                await holdRepo.save(hold);

                await outboxRepo.save({
                    aggregateType: 'PAYMENT',
                    aggregateId: paymentTx.id,
                    exchange: 'payment_exchange',
                    eventType: 'PAYMENT_SUCCEEDED',
                    payload: {
                        userId,
                        paymentTxId: paymentTx.id,
                        holdId: hold.id,
                        amount: hold.frozenPrice,
                        providerReference: stripeRef,
                    },
                });

                await outboxRepo.save({
                    aggregateType: 'APPOINTMENT',
                    aggregateId: hold.slotId,
                    exchange: 'appointment_exchange',
                    eventType: 'APPOINTMENT_BOOKED',
                    payload: {
                        userId,
                        doctorId: hold.doctorId,
                        slotId: hold.slotId,
                        instructions: 'Please arrive 15 minutes before the appointment.',
                    },
                });
            }

            return {
                status: 'DONE',
                message: 'Your appointment has been booked successfully',
                details: {
                    instruction: 'We will remind you, Please arrive 15 minutes before the appointment.',
                },
            };
        });
    }

    private async handleFailure(
        paymentTxId: string,
        holdId: string,
        reason: string,
        context?: FailureContext,
    ) {
        await this.dataSource.transaction(async (manager: EntityManager) => {
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const outboxRepo = manager.getRepository(OutboxEventEntity);
            const cardRepo = manager.getRepository(SavedCard);

            await paymentRepo.update(paymentTxId, {
                status: PaymentStatus.FAILED,
                failureReason: reason,
            });
            await manager.getRepository(SlotHold).delete(holdId);

            await outboxRepo.save({
                aggregateType: 'PAYMENT',
                aggregateId: paymentTxId,
                exchange: 'payment_exchange',
                eventType: 'PAYMENT_FAILED',
                payload: { paymentTxId, holdId, reason },
            });


            if (context?.isTokenInvalid && context.cardId && context.userId) {
                const card = await cardRepo.findOne({
                    where: { id: context.cardId, userId: context.userId },
                });

                if (card) {
                    await cardRepo.softDelete(card.id);

                    await outboxRepo.save({
                        aggregateType: 'PAYMENT_METHOD',
                        aggregateId: card.id,
                        exchange: 'payment_exchange',
                        eventType: 'PAYMENT_METHOD_REMOVED',
                        payload: {
                            userId: context.userId,
                            cardId: card.id,
                            last4Digits: card.last4Digits,
                            removedAt: new Date(),
                            reason: 'Card became invalid at payment provider',
                        },
                    });
                }
            }
        });
    }
}