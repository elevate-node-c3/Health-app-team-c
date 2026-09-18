import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchHistoryListener } from './search-history.listener';
import { UserSearchEntity } from '../../auth/entities/user-search.entity';
import { GuestSearchEntity } from '../../auth/entities/guest-search.entity';
import { SearchPerformedEvent } from '../events/search-performed.event';

describe('SearchHistoryListener', () => {
    let listener: SearchHistoryListener;
    let userSearchRepoMock: any;
    let guestSearchRepoMock: any;

    beforeEach(async () => {
        userSearchRepoMock = {
            findOne: jest.fn(),
            create: jest.fn((dto) => dto),
            save: jest.fn((dto) => Promise.resolve(dto)),
            count: jest.fn().mockResolvedValue(1),
            find: jest.fn().mockResolvedValue([]),
            remove: jest.fn(),
        };

        guestSearchRepoMock = {
            findOne: jest.fn(),
            create: jest.fn((dto) => dto),
            save: jest.fn((dto) => Promise.resolve(dto)),
            count: jest.fn().mockResolvedValue(1),
            find: jest.fn().mockResolvedValue([]),
            remove: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchHistoryListener,
                { provide: getRepositoryToken(UserSearchEntity), useValue: userSearchRepoMock },
                { provide: getRepositoryToken(GuestSearchEntity), useValue: guestSearchRepoMock },
            ],
        }).compile();

        listener = module.get<SearchHistoryListener>(SearchHistoryListener);
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    it('should insert new user search query if not previously searched', async () => {
        userSearchRepoMock.findOne.mockResolvedValue(null);

        const event = new SearchPerformedEvent({
            query: 'Pediatrics',
            userId: 'user-100',
            resultsCount: 5,
            timestamp: new Date(),
        });

        await listener.handleSearchPerformed(event);

        expect(userSearchRepoMock.create).toHaveBeenCalledWith({
            userId: 'user-100',
            searchQuery: 'Pediatrics',
        });
        expect(userSearchRepoMock.save).toHaveBeenCalled();
    });

    it('should update timestamp if user search query already exists (uniqueness)', async () => {
        const existingRecord = { id: 'search-1', userId: 'user-100', searchQuery: 'Pediatrics', updatedAt: new Date(1000) };
        userSearchRepoMock.findOne.mockResolvedValue(existingRecord);

        const event = new SearchPerformedEvent({
            query: 'Pediatrics',
            userId: 'user-100',
            resultsCount: 5,
            timestamp: new Date(),
        });

        await listener.handleSearchPerformed(event);

        expect(userSearchRepoMock.create).not.toHaveBeenCalled();
        expect(userSearchRepoMock.save).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'search-1',
                searchQuery: 'Pediatrics',
            }),
        );
    });

    it('should prune guest search history if exceeding limit of 20 items', async () => {
        guestSearchRepoMock.findOne.mockResolvedValue(null);
        guestSearchRepoMock.count.mockResolvedValue(22);
        const oldestRecords = [{ id: 'old-1' }, { id: 'old-2' }];
        guestSearchRepoMock.find.mockResolvedValue(oldestRecords);

        const event = new SearchPerformedEvent({
            query: 'Dermatology',
            deviceId: 'device-xyz',
            resultsCount: 3,
            timestamp: new Date(),
        });

        await listener.handleSearchPerformed(event);

        expect(guestSearchRepoMock.remove).toHaveBeenCalledWith(oldestRecords);
    });
});
