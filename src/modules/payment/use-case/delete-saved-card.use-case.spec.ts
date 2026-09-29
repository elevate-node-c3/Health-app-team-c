import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DeleteSavedCardUseCase } from './delete-saved-card.use-case';
import { SavedCard } from '../entities/saved-card.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

describe('DeleteSavedCardUseCase', () => {
    let useCase: DeleteSavedCardUseCase;
    let dataSource: jest.Mocked<DataSource>;

    const mockCardRepo = {
        findOne: jest.fn(),
        softDelete: jest.fn(),
        find: jest.fn(),
        update: jest.fn(),
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
                DeleteSavedCardUseCase,
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

        useCase = module.get<DeleteSavedCardUseCase>(DeleteSavedCardUseCase);
        dataSource = module.get(DataSource);
    });

    const mockUserId = 'user-123';
    const mockCardId = 'card-456';
    const currentYear = new Date().getFullYear();

    const mockCard: SavedCard = {
        id: mockCardId,
        userId: mockUserId,
        last4Digits: '4242',
        isDefault: false,
        expiryMonth: 12,
        expiryYear: currentYear + 1,
    } as unknown as SavedCard;

    describe('execute', () => {
        it('should throw NotFoundException if card does not exist', async () => {
            mockCardRepo.findOne.mockResolvedValue(null);

            await expect(
                useCase.execute(mockUserId, mockCardId)
            ).rejects.toThrow(NotFoundException);

            expect(mockCardRepo.findOne).toHaveBeenCalledWith({
                where: { id: mockCardId, userId: mockUserId },
            });
        });

        it('should delete non-default card successfully and record outbox event without setting new default card', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockCard, isDefault: false });

            const result = await useCase.execute(mockUserId, mockCardId);

            expect(mockCardRepo.softDelete).toHaveBeenCalledWith(mockCardId);
            expect(mockCardRepo.find).not.toHaveBeenCalled();
            expect(mockCardRepo.update).not.toHaveBeenCalled();
            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    aggregateType: 'PAYMENT_METHOD',
                    eventType: 'PAYMENT_METHOD_REMOVED',
                    payload: expect.objectContaining({
                        userId: mockUserId,
                        cardId: mockCardId,
                        last4Digits: '4242',
                    }),
                })
            );
            expect(result).toEqual({ success: true, message: 'Card removed successfully' });
        });

        it('when deleting the default card, the first non-expired card should be selected as the new default card', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockCard, isDefault: true });

            const expiredCard = {
                id: 'card-expired',
                expiryYear: currentYear - 1,
                expiryMonth: 1,
            } as SavedCard;

            const validCard = {
                id: 'card-valid',
                expiryYear: currentYear + 1,
                expiryMonth: 12,
            } as SavedCard;

            mockCardRepo.find.mockResolvedValue([expiredCard, validCard]);

            await useCase.execute(mockUserId, mockCardId);

            expect(mockCardRepo.softDelete).toHaveBeenCalledWith(mockCardId);
            expect(mockCardRepo.update).toHaveBeenCalledWith(
                { id: 'card-valid' },
                { isDefault: true }
            );
        });

        it('when deleting the default card and all remaining cards are expired, the newest card should be selected', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockCard, isDefault: true });

            const expiredCard1 = {
                id: 'card-expired-newest',
                expiryYear: currentYear - 1,
                expiryMonth: 1,
            } as SavedCard;

            const expiredCard2 = {
                id: 'card-expired-older',
                expiryYear: currentYear - 2,
                expiryMonth: 1,
            } as SavedCard;

            mockCardRepo.find.mockResolvedValue([expiredCard1, expiredCard2]);

            await useCase.execute(mockUserId, mockCardId);

            expect(mockCardRepo.update).toHaveBeenCalledWith(
                { id: 'card-expired-newest' },
                { isDefault: true }
            );
        });

        it('when deleting the default card and no cards are left for the user, update is not called', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockCard, isDefault: true });
            mockCardRepo.find.mockResolvedValue([]);

            await useCase.execute(mockUserId, mockCardId);

            expect(mockCardRepo.softDelete).toHaveBeenCalledWith(mockCardId);
            expect(mockCardRepo.update).not.toHaveBeenCalled();
        });

        it('should execute the operation using externalEntityManager if passed', async () => {
            mockCardRepo.findOne.mockResolvedValue({ ...mockCard });

            await useCase.execute(mockUserId, mockCardId, mockEntityManager);

            expect(dataSource.transaction).not.toHaveBeenCalled();
            expect(mockEntityManager.getRepository).toHaveBeenCalledWith(SavedCard);
        });
    });
});