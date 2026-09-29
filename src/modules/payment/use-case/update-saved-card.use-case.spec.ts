import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UpdateSavedCardUseCase } from './update-saved-card.use-case';
import { SavedCard } from '../entities/saved-card.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';

describe('UpdateSavedCardUseCase', () => {
    let useCase: UpdateSavedCardUseCase;
    let dataSource: jest.Mocked<DataSource>;

    const mockCardRepo = {
        findOne: jest.fn(),
        update: jest.fn(),
        save: jest.fn(),
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
                UpdateSavedCardUseCase,
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

        useCase = module.get<UpdateSavedCardUseCase>(UpdateSavedCardUseCase);
        dataSource = module.get(DataSource);
    });

    const mockUserId = 'user-123';
    const mockCardId = 'card-456';
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const mockExistingCard: SavedCard = {
        id: mockCardId,
        userId: mockUserId,
        cardHolderName: 'Old Name',
        cardBrand: 'Visa',
        last4Digits: '4242',
        expiryMonth: 12,
        expiryYear: currentYear + 1,
        isDefault: false,
    } as unknown as SavedCard;

    describe('execute', () => {
        it('should throw NotFoundException if card does not exist', async () => {
            mockCardRepo.findOne.mockResolvedValue(null);

            await expect(
                useCase.execute(mockUserId, mockCardId, { cardHolderName: 'New Name' })
            ).rejects.toThrow(NotFoundException);

            expect(mockCardRepo.findOne).toHaveBeenCalledWith({
                where: { id: mockCardId, userId: mockUserId },
            });
        });

        it('should throw BadRequestException when trying to set an expired card as default', async () => {
            const expiredCard = {
                ...mockExistingCard,
                expiryYear: currentYear - 1,
            };
            mockCardRepo.findOne.mockResolvedValue(expiredCard);

            await expect(
                useCase.execute(mockUserId, mockCardId, { isDefault: true })
            ).rejects.toThrow(BadRequestException);
        });

        it('should update the card holder name successfully without changing the default status', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockExistingCard });
            mockCardRepo.save.mockImplementation(async (card) => card);

            const result = await useCase.execute(mockUserId, mockCardId, {
                cardHolderName: 'New Holder Name',
            });

            expect(mockCardRepo.update).not.toHaveBeenCalled();
            expect(mockOutboxRepo.save).not.toHaveBeenCalled();
            expect(result.cardHolderName).toBe('New Holder Name');
        });

        it('should set the card as default and unset other cards as default, and send outbox event', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockExistingCard });
            mockCardRepo.save.mockImplementation(async (card) => card);

            const result = await useCase.execute(mockUserId, mockCardId, { isDefault: true });

            expect(mockCardRepo.update).toHaveBeenCalledWith(
                { userId: mockUserId, isDefault: true },
                { isDefault: false }
            );

            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'PAYMENT_METHOD',
                    eventType: 'DEFAULT_PAYMENT_METHOD_CHANGED',
                    payload: expect.objectContaining({
                        userId: mockUserId,
                        cardId: mockCardId,
                    }),
                })
            );

            expect(result.isDefault).toBe(true);
        });

        it('should execute the operation using externalEntityManager if passed, and should not start a new transaction', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockExistingCard });
            mockCardRepo.save.mockImplementation(async (card) => card);

            await useCase.execute(
                mockUserId,
                mockCardId,
                { cardHolderName: 'External Manager Test' },
                mockEntityManager
            );

            expect(dataSource.transaction).not.toHaveBeenCalled();
            expect(mockEntityManager.getRepository).toHaveBeenCalledWith(SavedCard);
        });
    });
});