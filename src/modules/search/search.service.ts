import { Injectable } from '@nestjs/common';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchDoctorsAndSpecialtiesUseCase, SearchIdentity } from './use-case/search-doctors-and-specialties.use-case';
import { GetSearchSuggestionsUseCase } from './use-case/get-search-suggestions.use-case';
import { ManageSearchHistoryUseCase } from './use-case/manage-search-history.use-case';

@Injectable()
export class SearchService {
    constructor(
        private readonly searchDoctorsAndSpecialtiesUseCase: SearchDoctorsAndSpecialtiesUseCase,
        private readonly getSearchSuggestionsUseCase: GetSearchSuggestionsUseCase,
        private readonly manageSearchHistoryUseCase: ManageSearchHistoryUseCase,
    ) { }

    async search(dto: SearchQueryDto, identity: SearchIdentity) {
        return this.searchDoctorsAndSpecialtiesUseCase.execute(dto, identity);
    }

    async getSuggestions(dto: SearchQueryDto, identity: SearchIdentity) {
        return this.getSearchSuggestionsUseCase.execute(dto, identity);
    }

    async getHistory(identity: SearchIdentity) {
        return this.manageSearchHistoryUseCase.getHistory(identity);
    }

    async clearHistory(identity: SearchIdentity) {
        return this.manageSearchHistoryUseCase.clearHistory(identity);
    }

    async deleteHistoryItem(id: string, identity: SearchIdentity) {
        return this.manageSearchHistoryUseCase.deleteHistoryItem(id, identity);
    }
}
