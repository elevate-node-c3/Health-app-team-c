import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { SavedCard } from '../entities/saved-card.entity';
import { CreateSavedCardDto } from '../dto/create-saved-card.dto';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

@Injectable()
export class AddSavedCardUseCase {
  constructor(
    @InjectRepository(SavedCard)
    private readonly savedCardRepo: Repository<SavedCard>,
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepo: Repository<OutboxEventEntity>,
    private readonly dataSource: DataSource,
  ) { }

  async execute(
    userId: string,
    dto: CreateSavedCardDto,
    externalEntityManager?: EntityManager,
  ) {

    if (!dto.saveCard) {
      return {
        message: 'Card used for one-time transaction, not stored.',
        stored: false,
      };
    }


    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (
      dto.expiryYear < currentYear ||
      (dto.expiryYear === currentYear && dto.expiryMonth < currentMonth)
    ) {
      throw new BadRequestException('Cannot add an expired card.');
    }

    const runInTransaction = async (manager: EntityManager) => {
      const cardRepo = manager.getRepository(SavedCard);
      const outboxRepo = manager.getRepository(OutboxEventEntity);

      let card = await cardRepo.findOne({
        where: [
          { userId, providerCardToken: dto.providerCardToken },
          {
            userId,
            last4Digits: dto.last4Digits,
            cardBrand: dto.cardBrand,
            expiryMonth: dto.expiryMonth,
            expiryYear: dto.expiryYear,
          },
        ],
        withDeleted: true,
      });

      if (card) {
        if (card.deletedAt) {
          await cardRepo.restore(card.id);
          card.deletedAt = null;
        }

        card.providerCardToken = dto.providerCardToken;
        card.cardHolderName = dto.cardHolderName;
        card = await cardRepo.save(card);
      } else {
        const userCardsCount = await cardRepo.count({ where: { userId } });
        const isDefault = userCardsCount === 0;

        card = cardRepo.create({
          userId,
          cardHolderName: dto.cardHolderName,
          cardBrand: dto.cardBrand,
          last4Digits: dto.last4Digits,
          expiryMonth: dto.expiryMonth,
          expiryYear: dto.expiryYear,
          providerCardToken: dto.providerCardToken,
          providerName: dto.providerName || 'stripe',
          isDefault,
        });

        card = await cardRepo.save(card);
      }

      await outboxRepo.save({
        aggregateId: card.id,
        aggregateType: 'PAYMENT_METHOD',
        exchange: 'payment_exchange',
        eventType: 'PAYMENT_METHOD_ADDED',
        payload: {
          userId,
          cardId: card.id,
          cardBrand: card.cardBrand,
          last4Digits: card.last4Digits,
          addedAt: new Date(),
        },
      });

      return {
        id: card.id,
        cardHolderName: card.cardHolderName,
        cardBrand: card.cardBrand,
        last4Digits: card.last4Digits,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        isDefault: card.isDefault,

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