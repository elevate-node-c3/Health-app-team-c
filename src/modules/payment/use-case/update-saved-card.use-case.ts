import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { SavedCard } from '../entities/saved-card.entity';
import { UpdateSavedCardDto } from '../dto/update-saved-card.dto';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

@Injectable()
export class UpdateSavedCardUseCase {
    constructor(
        @InjectRepository(SavedCard)
        private readonly savedCardRepository: Repository<SavedCard>,
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepo: Repository<OutboxEventEntity>,
        private readonly dataSource: DataSource,
    ) { }

    async execute(
        userId: string,
        cardId: string,
        dto: UpdateSavedCardDto,
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


            if (dto.expiryMonth !== undefined) card.expiryMonth = dto.expiryMonth;
            if (dto.expiryYear !== undefined) card.expiryYear = dto.expiryYear;

            if (dto.expiryMonth !== undefined || dto.expiryYear !== undefined) {
                const now = new Date();
                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth() + 1;
                const willBeExpired =
                    card.expiryYear < currentYear ||
                    (card.expiryYear === currentYear && card.expiryMonth < currentMonth);
                if (willBeExpired) {
                    throw new BadRequestException('Cannot set an expired expiry date');
                }
            }

            if (dto.isDefault === true) {
                const now = new Date();
                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth() + 1;

                const isExpired =
                    card.expiryYear < currentYear ||
                    (card.expiryYear === currentYear && card.expiryMonth < currentMonth);

                if (isExpired) {
                    throw new BadRequestException(
                        'Cannot set an expired card as default payment method',
                    );
                }

                await cardRepo.update({ userId, isDefault: true }, { isDefault: false });
                card.isDefault = true;
            }

            if (dto.cardHolderName) {
                card.cardHolderName = dto.cardHolderName;
            }

            const updatedCard = await cardRepo.save(card);

            if (dto.isDefault === true) {
                await outboxRepo.save({
                    aggregateId: updatedCard.id,
                    aggregateType: 'PAYMENT_METHOD',
                    exchange: 'payment_exchange',
                    eventType: 'DEFAULT_PAYMENT_METHOD_CHANGED',
                    payload: {
                        userId,
                        cardId: updatedCard.id,
                        updatedAt: new Date(),
                    },
                });
            }

            return {
                id: updatedCard.id,
                cardHolderName: updatedCard.cardHolderName,
                cardBrand: updatedCard.cardBrand,
                last4Digits: updatedCard.last4Digits,
                expiryMonth: updatedCard.expiryMonth,
                expiryYear: updatedCard.expiryYear,
                isDefault: updatedCard.isDefault,
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