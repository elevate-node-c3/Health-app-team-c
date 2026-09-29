import {
    Injectable,
    BadRequestException,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ProcessPaymentDto } from '../dto/process-payment.dto';
import { StripeService } from '../services/stripe.service';
import { PaymentTransaction, PaymentStatus } from '../entities/payment-transaction.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { SavedCard } from '../entities/saved-card.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { SlotHoldEntity, SlotHoldStatus } from 'src/modules/booking/entities/slot-hold.entity';

interface PreparedIntent {
    alreadySucceeded: boolean;
    response?: any;
    hold?: SlotHoldEntity;
    paymentTx?: PaymentTransaction;
    doctorUnavailable?: boolean;
}

interface FailureContext {
    isTokenInvalid?: boolean;
    cardId?: string;
    userId?: string;
}

const SUCCESS_RESPONSE = {
    status: 'DONE',
    message: 'Your appointment has been booked successfully',
    details: {
        instruction: 'We will remind you, Please arrive 15 minutes before the appointment.',
    },
};

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

        if (prepared.doctorUnavailable) {
            throw new BadRequestException(
                'This doctor is no longer available for appointments. Please choose another time or doctor.',
            );
        }

        const { hold, paymentTx } = prepared as {
            hold: SlotHoldEntity;
            paymentTx: PaymentTransaction;
        };

        let stripeResult: any;
        try {
            stripeResult = await this.stripeService.chargeCard({
                amount: Number(hold.frozenFee),
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
                hold.id,
                paymentTx.id,
                stripeResult.transactionReference || '',
            );
        } catch (error) {
            await this.dataSource.getRepository(PaymentTransaction).update(paymentTx.id, {
                status: PaymentStatus.REQUIRES_RECONCILIATION,
                failureReason:
                    error instanceof ConflictException
                        ? 'Charged but hold no longer active'
                        : 'Booking completion failed after charge',
            });
            throw new InternalServerErrorException('Booking completion failed.');
        }
    }

    private async preparePaymentIntent(
        userId: string,
        dto: ProcessPaymentDto,
    ): Promise<PreparedIntent> {
        return await this.dataSource.transaction(async (manager: EntityManager) => {
            const holdRepo = manager.getRepository(SlotHoldEntity);
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const doctorRepo = manager.getRepository(DoctorEntity);

            const idempotencyKey = `PAY-${dto.holdId}-${userId}`;

            const existingTx = await paymentRepo
                .createQueryBuilder('tx')
                .setLock('pessimistic_write')
                .where('tx.idempotencyKey = :idempotencyKey', { idempotencyKey })
                .getOne();

            if (existingTx?.status === PaymentStatus.SUCCESS) {
                return { alreadySucceeded: true, response: SUCCESS_RESPONSE };
            }

            const hold = await holdRepo
                .createQueryBuilder('hold')
                .setLock('pessimistic_write')
                .where('hold.id = :holdId AND hold.patientId = :patientId', {
                    holdId: dto.holdId,
                    patientId: userId,
                })
                .getOne();

            if (!hold) throw new NotFoundException('Slot hold not found');

            if (
                hold.status === SlotHoldStatus.CONSUMED &&
                existingTx?.status !== PaymentStatus.PENDING
            ) {
                throw new ConflictException('Slot already booked');
            }

            const isExpired =
                hold.status === SlotHoldStatus.EXPIRED ||
                (hold.status === SlotHoldStatus.ACTIVE && new Date() > hold.expiresAt);
            if (isExpired) throw new BadRequestException('Hold expired');

            const doctor = await doctorRepo.findOne({ where: { id: hold.doctorId } });
            if (!doctor || !doctor.isActive) {
                await holdRepo.update(hold.id, { status: SlotHoldStatus.EXPIRED });
                return { alreadySucceeded: false, doctorUnavailable: true };
            }

            let paymentTx = existingTx;
            if (!paymentTx) {
                paymentTx = paymentRepo.create({
                    userId,
                    holdId: hold.id,
                    amount: hold.frozenFee,
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
        holdId: string,
        paymentTxId: string,
        stripeRef: string,
    ) {
        return await this.dataSource.transaction(async (manager: EntityManager) => {
            const paymentRepo = manager.getRepository(PaymentTransaction);
            const outboxRepo = manager.getRepository(OutboxEventEntity);
            const holdRepo = manager.getRepository(SlotHoldEntity);

            const paymentTx = await paymentRepo
                .createQueryBuilder('tx')
                .setLock('pessimistic_write')
                .where('tx.id = :paymentTxId', { paymentTxId })
                .getOne();

            if (!paymentTx) throw new NotFoundException('Payment transaction not found');

            const hold = await holdRepo
                .createQueryBuilder('hold')
                .setLock('pessimistic_write')
                .where('hold.id = :holdId', { holdId })
                .getOne();

            if (!hold) throw new NotFoundException('Slot hold not found');

            if (paymentTx.status !== PaymentStatus.SUCCESS) {
                if (
                    hold.status !== SlotHoldStatus.ACTIVE &&
                    hold.status !== SlotHoldStatus.CONSUMED
                ) {
                    throw new ConflictException('Hold no longer active after charge');
                }

                paymentTx.status = PaymentStatus.SUCCESS;
                paymentTx.providerReference = stripeRef;
                await paymentRepo.save(paymentTx);

                await holdRepo.update(hold.id, { status: SlotHoldStatus.CONSUMED });

                await outboxRepo.save({
                    aggregateType: 'PAYMENT',
                    aggregateId: paymentTx.id,
                    exchange: 'payment_exchange',
                    eventType: 'PAYMENT_SUCCEEDED',
                    payload: {
                        userId,
                        paymentTxId: paymentTx.id,
                        holdId: hold.id,
                        amount: Number(hold.frozenFee),
                        providerReference: stripeRef,
                    },
                });

                await outboxRepo.save({
                    aggregateType: 'APPOINTMENT',
                    aggregateId: hold.id,
                    exchange: 'appointment_exchange',
                    eventType: 'APPOINTMENT_BOOKED',
                    payload: {
                        userId,
                        patientId: hold.patientId,
                        holdId: hold.id,
                        doctorId: hold.doctorId,
                        clinicId: hold.clinicId,
                        date: hold.date,
                        startTime: hold.startTime,
                        endTime: hold.endTime,
                        instructions: 'Please arrive 15 minutes before the appointment.',
                    },
                });
            }

            return SUCCESS_RESPONSE;
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

            await manager.getRepository(SlotHoldEntity).update(holdId, {
                status: SlotHoldStatus.EXPIRED,
            });

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