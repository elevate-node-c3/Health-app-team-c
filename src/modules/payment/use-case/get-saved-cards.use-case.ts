import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedCard } from '../entities/saved-card.entity';

export interface SavedCardResponseDto {
    id: string;
    cardHolderName: string;
    cardBrand: string;
    last4Digits: string;
    expiryMonth: number;
    expiryYear: number;
    isDefault: boolean;
    isExpired: boolean;
}

@Injectable()
export class GetSavedCardsUseCase {
    constructor(
        @InjectRepository(SavedCard)
        private readonly savedCardRepository: Repository<SavedCard>,
    ) { }

    async execute(userId: string): Promise<SavedCardResponseDto[]> {
        const cards = await this.savedCardRepository.find({
            where: { userId },
            order: { isDefault: 'DESC', createdAt: 'DESC' },
        });

        if (!cards.length) {
            return [];
        }

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        let hasValidDefault = false;
        let cardToPromoteToDefault: SavedCard | null = null;

        const mappedCards: SavedCardResponseDto[] = cards.map((card) => {
            const isExpired =
                card.expiryYear < currentYear ||
                (card.expiryYear === currentYear && card.expiryMonth < currentMonth);

            if (card.isDefault && !isExpired) {
                hasValidDefault = true;
            }

            if (!hasValidDefault && !isExpired && !cardToPromoteToDefault) {
                cardToPromoteToDefault = card;
            }

            return {
                id: card.id,
                cardHolderName: card.cardHolderName,
                cardBrand: card.cardBrand,
                last4Digits: card.last4Digits,
                expiryMonth: card.expiryMonth,
                expiryYear: card.expiryYear,
                isDefault: card.isDefault,
                isExpired,
            };
        });

        if (!hasValidDefault && cardToPromoteToDefault) {
            const targetCardId: string = (cardToPromoteToDefault as SavedCard).id;

            await this.savedCardRepository.update({ userId }, { isDefault: false });
            await this.savedCardRepository.update(
                { id: targetCardId },
                { isDefault: true },
            );

            mappedCards.forEach((c) => {
                c.isDefault = c.id === targetCardId;
            });
        }

        return mappedCards;
    }
}