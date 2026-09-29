import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GetSavedCardsUseCase } from './get-saved-cards.use-case';
import { SavedCard } from '../entities/saved-card.entity';

describe('GetSavedCardsUseCase', () => {
    let useCase: GetSavedCardsUseCase;
    let savedCardRepository: jest.Mocked<Repository<SavedCard>>;

    const mockUserId = 'user-uuid-123';

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetSavedCardsUseCase,
                {
                    provide: getRepositoryToken(SavedCard),
                    useValue: {
                        find: jest.fn(),
                        update: jest.fn(),
                    },
                },
            ],
        }).compile();

        useCase = module.get<GetSavedCardsUseCase>(GetSavedCardsUseCase);
        savedCardRepository = module.get(getRepositoryToken(SavedCard));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    describe('execute', () => {
        it('1. should return an empty array if the user has no saved cards', async () => {
            savedCardRepository.find.mockResolvedValue([]);

            const result = await useCase.execute(mockUserId);

            expect(savedCardRepository.find).toHaveBeenCalledWith({
                where: { userId: mockUserId },
                order: { isDefault: 'DESC', createdAt: 'DESC' },
            });
            expect(result).toEqual([]);
            expect(savedCardRepository.update).not.toHaveBeenCalled();
        });

        it('2. should return cards correctly when a valid default card exists', async () => {
            const mockCards = [
                {
                    id: 'card-1',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'VISA',
                    last4Digits: '4242',
                    expiryMonth: 12,
                    expiryYear: currentYear + 1,
                    isDefault: true,
                },
                {
                    id: 'card-2',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'MASTERCARD',
                    last4Digits: '5555',
                    expiryMonth: 5,
                    expiryYear: currentYear + 2,
                    isDefault: false,
                },
            ] as SavedCard[];

            savedCardRepository.find.mockResolvedValue(mockCards);

            const result = await useCase.execute(mockUserId);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                id: 'card-1',
                cardHolderName: 'John Doe',
                cardBrand: 'VISA',
                last4Digits: '4242',
                expiryMonth: 12,
                expiryYear: currentYear + 1,
                isDefault: true,
                isExpired: false,
            });
            expect(result[1].isDefault).toBe(false);
            expect(savedCardRepository.update).not.toHaveBeenCalled();
        });

        it('3. should promote the first valid card to default if the current default card is expired', async () => {
            const mockCards = [
                {
                    id: 'card-expired-default',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'VISA',
                    last4Digits: '1111',
                    expiryMonth: 1,
                    expiryYear: currentYear - 1,
                    isDefault: true,
                },
                {
                    id: 'card-valid-next',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'MASTERCARD',
                    last4Digits: '2222',
                    expiryMonth: 12,
                    expiryYear: currentYear + 2,
                    isDefault: false,
                },
            ] as SavedCard[];

            savedCardRepository.find.mockResolvedValue(mockCards);
            savedCardRepository.update.mockResolvedValue({} as any);

            const result = await useCase.execute(mockUserId);

            expect(savedCardRepository.update).toHaveBeenNthCalledWith(
                1,
                { userId: mockUserId },
                { isDefault: false },
            );
            expect(savedCardRepository.update).toHaveBeenNthCalledWith(
                2,
                { id: 'card-valid-next' },
                { isDefault: true },
            );

            expect(result[0].id).toBe('card-expired-default');
            expect(result[0].isDefault).toBe(false);
            expect(result[0].isExpired).toBe(true);

            expect(result[1].id).toBe('card-valid-next');
            expect(result[1].isDefault).toBe(true);
            expect(result[1].isExpired).toBe(false);
        });

        it('4. should correctly identify expired cards based on current month and year', async () => {
            const mockCards = [
                {
                    id: 'card-expired-same-year',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'VISA',
                    last4Digits: '9999',
                    expiryMonth: currentMonth === 1 ? 12 : currentMonth - 1,
                    expiryYear: currentMonth === 1 ? currentYear - 1 : currentYear,
                    isDefault: false,
                },
            ] as SavedCard[];

            savedCardRepository.find.mockResolvedValue(mockCards);

            const result = await useCase.execute(mockUserId);

            expect(result[0].isExpired).toBe(true);
        });

        it('5. should handle cases where all cards are expired without promoting any card to default', async () => {
            const mockCards = [
                {
                    id: 'card-1',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'VISA',
                    last4Digits: '1111',
                    expiryMonth: 1,
                    expiryYear: currentYear - 2,
                    isDefault: false,
                },
                {
                    id: 'card-2',
                    userId: mockUserId,
                    cardHolderName: 'John Doe',
                    cardBrand: 'MASTERCARD',
                    last4Digits: '2222',
                    expiryMonth: 1,
                    expiryYear: currentYear - 1,
                    isDefault: false,
                },
            ] as SavedCard[];

            savedCardRepository.find.mockResolvedValue(mockCards);

            const result = await useCase.execute(mockUserId);

            expect(result).toHaveLength(2);
            expect(result[0].isDefault).toBe(false);
            expect(result[1].isDefault).toBe(false);
            expect(result[0].isExpired).toBe(true);
            expect(result[1].isExpired).toBe(true);
            expect(savedCardRepository.update).not.toHaveBeenCalled();
        });
    });
});