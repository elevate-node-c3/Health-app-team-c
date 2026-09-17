import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { SearchDoctorsAndSpecialtiesUseCase } from './use-case/search-doctors-and-specialties.use-case';
import { GetSearchSuggestionsUseCase } from './use-case/get-search-suggestions.use-case';
import { ManageSearchHistoryUseCase } from './use-case/manage-search-history.use-case';

describe('SearchService', () => {
    let service: SearchService;
    let searchUseCaseMock: any;
    let suggestionsUseCaseMock: any;
    let historyUseCaseMock: any;

    beforeEach(async () => {
        searchUseCaseMock = { execute: jest.fn() };
        suggestionsUseCaseMock = { execute: jest.fn() };
        historyUseCaseMock = {
            getHistory: jest.fn(),
            clearHistory: jest.fn(),
            deleteHistoryItem: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchService,
                { provide: SearchDoctorsAndSpecialtiesUseCase, useValue: searchUseCaseMock },
                { provide: GetSearchSuggestionsUseCase, useValue: suggestionsUseCaseMock },
                { provide: ManageSearchHistoryUseCase, useValue: historyUseCaseMock },
            ],
        }).compile();

        service = module.get<SearchService>(SearchService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should delegate search to SearchDoctorsAndSpecialtiesUseCase', async () => {
        searchUseCaseMock.execute.mockResolvedValue({ success: true, data: {} });
        const result = await service.search({ q: 'cardio' }, { userId: 'user-1' });
        expect(searchUseCaseMock.execute).toHaveBeenCalledWith({ q: 'cardio' }, { userId: 'user-1' });
        expect(result).toEqual({ success: true, data: {} });
    });

    it('should delegate suggestions to GetSearchSuggestionsUseCase', async () => {
        suggestionsUseCaseMock.execute.mockResolvedValue({ success: true, data: {} });
        const result = await service.getSuggestions({ q: 'cardio' }, { userId: 'user-1' });
        expect(suggestionsUseCaseMock.execute).toHaveBeenCalledWith({ q: 'cardio' }, { userId: 'user-1' });
        expect(result).toEqual({ success: true, data: {} });
    });

    it('should delegate history retrieval to ManageSearchHistoryUseCase', async () => {
        historyUseCaseMock.getHistory.mockResolvedValue({ success: true, data: [] });
        const result = await service.getHistory({ userId: 'user-1' });
        expect(historyUseCaseMock.getHistory).toHaveBeenCalledWith({ userId: 'user-1' });
        expect(result).toEqual({ success: true, data: [] });
    });
});
