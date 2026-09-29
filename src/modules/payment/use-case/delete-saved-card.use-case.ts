import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { SavedCard } from '../entities/saved-card.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

@Injectable()
export class DeleteSavedCardUseCase {
    constructor(
        @InjectRepository(SavedCard)
        private readonly savedCardRepo: Repository<SavedCard>,
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepo: Repository<OutboxEventEntity>,
        private readonly dataSource: DataSource,
    ) { }

    async execute(
        userId: string,
        cardId: string,
        externalEntityManager?: EntityManager,
    ) {
        const runInTransaction = async (manager: EntityManager) => {
            const cardRepo = manager.getRepository(SavedCard);
            const outboxRepo = manager.getRepository(OutboxEventEntity);

            const card = await cardRepo.findOne({
                where: { id: cardId, userId },
            });

            if (!card) {
                throw new NotFoundException(
                    'Card not found or does not belong to user',
                );
            }

            await cardRepo.softDelete(cardId);

            if (card.isDefault) {
                const remainingCards = await cardRepo.find({
                    where: { userId },
                    order: { createdAt: 'DESC' },
                });

                if (remainingCards.length > 0) {
                    const now = new Date();
                    const currentYear = now.getFullYear();
                    const currentMonth = now.getMonth() + 1;

                    const nextDefaultCard = remainingCards.find((c) => {
                        const isExpired =
                            c.expiryYear < currentYear ||
                            (c.expiryYear === currentYear && c.expiryMonth < currentMonth);
                        return !isExpired;
                    });

                    if (nextDefaultCard) {
                        await cardRepo.update(
                            { id: nextDefaultCard.id },
                            { isDefault: true },
                        );
                    } else {
                        await cardRepo.update(
                            { id: remainingCards[0].id },
                            { isDefault: true },
                        );
                    }
                }
            }

            await outboxRepo.save({
                aggregateId: card.id,
                aggregateType: 'PAYMENT_METHOD',
                exchange: 'payment_exchange',
                eventType: 'PAYMENT_METHOD_REMOVED',
                payload: {
                    userId,
                    cardId,
                    last4Digits: card.last4Digits,
                    removedAt: new Date(),
                },
            });

            return {
                success: true,
                message: 'Card removed successfully',
            };
        };

        if (externalEntityManager) {
            return await runInTransaction(externalEntityManager);
        } else {
            return await this.dataSource.transaction(async (manager) => {
                return await runInTransaction(manager);
            });
        }
    }
}