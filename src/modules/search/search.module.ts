import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchDoctorsAndSpecialtiesUseCase } from './use-case/search-doctors-and-specialties.use-case';
import { GetSearchSuggestionsUseCase } from './use-case/get-search-suggestions.use-case';
import { ManageSearchHistoryUseCase } from './use-case/manage-search-history.use-case';
import { SearchHistoryListener } from './listeners/search-history.listener';
import { SearchAnalyticsListener } from './listeners/search-analytics.listener';
import { DoctorEntity } from '../catalog/entities/doctor.entity';
import { SpecialtyEntity } from '../catalog/entities/specialty.entity';
import { UserSearchEntity } from '../auth/entities/user-search.entity';
import { GuestSearchEntity } from '../auth/entities/guest-search.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            DoctorEntity,
            SpecialtyEntity,
            UserSearchEntity,
            GuestSearchEntity,
        ]),
    ],
    controllers: [SearchController],
    providers: [
        SearchService,
        SearchDoctorsAndSpecialtiesUseCase,
        GetSearchSuggestionsUseCase,
        ManageSearchHistoryUseCase,
        SearchHistoryListener,
        SearchAnalyticsListener,
    ],
    exports: [
        SearchService,
        SearchDoctorsAndSpecialtiesUseCase,
        GetSearchSuggestionsUseCase,
        ManageSearchHistoryUseCase,
    ],
})
export class SearchModule { }
