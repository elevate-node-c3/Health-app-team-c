import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AddSavedCardUseCase } from './add-saved-card.use-case';
import { CardBrand, SavedCard } from '../entities/saved-card.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { CreateSavedCardDto } from '../dto/create-saved-card.dto';

describe('AddSavedCardUseCase', () => {
    let useCase: AddSavedCardUseCase;
    let dataSource: jest.Mocked<DataSource>;

    const mockCardRepo = {
        findOne: jest.fn(),
        restore: jest.fn(),
        save: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
    };

    const mockOutboxRepo = {
        save: jest.fn(),
    };

    const mockEntityManager = {
        getRepository: jest.fn((entity) => {
            if (entity === SavedCard) return mockCardRepo;
            if (entity === OutboxEventEntity) return mockOutboxRepo;
            return null;
        }),
    } as unknown as jest.Mocked<EntityManager>;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AddSavedCardUseCase,
                {
                    provide: getRepositoryToken(SavedCard),
                    useValue: {},
                },
                {
                    provide: getRepositoryToken(OutboxEventEntity),
                    useValue: {},
                },
                {
                    provide: DataSource,
                    useValue: {
                        transaction: jest.fn().mockImplementation(async (cb) => cb(mockEntityManager)),
                    },
                },
            ],
        }).compile();

        useCase = module.get<AddSavedCardUseCase>(AddSavedCardUseCase);
        dataSource = module.get(DataSource);
    });

    const mockUserId = 'user-123';
    const currentYear = new Date().getFullYear();

    const mockDto: CreateSavedCardDto = {
        cardHolderName: 'John Doe',
        cardBrand: CardBrand.VISA,
        last4Digits: '4242',
        expiryMonth: 12,
        expiryYear: currentYear + 1,
        providerCardToken: 'tok_123',
        providerName: 'paymob',
        saveCard: true,
    };

    describe('execute', () => {
        it('should return a message of not saving if saveCard is false without starting a transaction', async () => {
            const dto = { ...mockDto, saveCard: false };

            const result = await useCase.execute(mockUserId, dto);

            expect(result).toEqual({
                message: 'Card used for one-time transaction, not stored.',
                stored: false,
            });
            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it('should throw BadRequestException if the card is expired', async () => {
            const expiredDto = {
                ...mockDto,
                expiryYear: currentYear - 1,
            };

            await expect(
                useCase.execute(mockUserId, expiredDto)
            ).rejects.toThrow(BadRequestException);
        });

        it('If the card exists and is soft deleted, it should be restored and its data updated', async () => {
            const existingSoftDeletedCard = {
                id: 'card-old',
                userId: mockUserId,
                deletedAt: new Date(),
                cardHolderName: 'Old Name',
                providerCardToken: 'tok_old',
            };

            mockCardRepo.findOne.mockResolvedValue(existingSoftDeletedCard);
            mockCardRepo.save.mockImplementation(async (c) => c);

            const result = (await useCase.execute(mockUserId, mockDto)) as { id: string };

            expect(mockCardRepo.restore).toHaveBeenCalledWith('card-old');
            expect(existingSoftDeletedCard.deletedAt).toBeNull();
            expect(existingSoftDeletedCard.cardHolderName).toBe(mockDto.cardHolderName);
            expect(mockOutboxRepo.save).toHaveBeenCalled();
            expect(result.id).toBe('card-old');
        });

        it('If the card is new and the first card for the user, it should be created and set as isDefault = true', async () => {
            mockCardRepo.findOne.mockResolvedValue(null);
            mockCardRepo.count.mockResolvedValue(0);

            const createdCard = {
                id: 'card-new-1',
                ...mockDto,
                isDefault: true,
            };

            mockCardRepo.create.mockReturnValue(createdCard);
            mockCardRepo.save.mockResolvedValue(createdCard);

            const result = (await useCase.execute(mockUserId, mockDto)) as { id: string; isDefault: boolean };

            expect(mockCardRepo.count).toHaveBeenCalledWith({ where: { userId: mockUserId } });
            expect(mockCardRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: mockUserId,
                    isDefault: true,
                })
            );
            expect(result.id).toBe('card-new-1');
            expect(result.isDefault).toBe(true);
            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'PAYMENT_METHOD',
                    eventType: 'PAYMENT_METHOD_ADDED',
                })
            );
        });

        it('If the card is new and the user has other cards, it should be created and set as isDefault = false', async () => {
            mockCardRepo.findOne.mockResolvedValue(null);
            mockCardRepo.count.mockResolvedValue(2);

            const createdCard = {
                id: 'card-new-2',
                ...mockDto,
                isDefault: false,
            };

            mockCardRepo.create.mockReturnValue(createdCard);
            mockCardRepo.save.mockResolvedValue(createdCard);

            const result = (await useCase.execute(mockUserId, mockDto)) as { isDefault: boolean };

            expect(mockCardRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    isDefault: false,
                })
            );
            expect(result.isDefault).toBe(false);
        });

        it('should use externalEntityManager if passed through the arguments', async () => {
            mockCardRepo.findOne.mockResolvedValue(null);
            mockCardRepo.count.mockResolvedValue(0);
            mockCardRepo.create.mockReturnValue({ id: 'card-ext', ...mockDto });
            mockCardRepo.save.mockResolvedValue({ id: 'card-ext', ...mockDto });

            await useCase.execute(mockUserId, mockDto, mockEntityManager);

            expect(dataSource.transaction).not.toHaveBeenCalled();
            expect(mockEntityManager.getRepository).toHaveBeenCalledWith(SavedCard);
        });
    });
});