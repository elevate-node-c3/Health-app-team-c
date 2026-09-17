import { Injectable } from '@nestjs/common';
import { SearchDoctorsAndSpecialtiesUseCase, SearchIdentity } from './search-doctors-and-specialties.use-case';
import { SearchQueryDto } from '../dto/search-query.dto';

@Injectable()
export class GetSearchSuggestionsUseCase {
    constructor(
        private readonly searchDoctorsAndSpecialtiesUseCase: SearchDoctorsAndSpecialtiesUseCase,
    ) { }

    async execute(dto: SearchQueryDto, identity: SearchIdentity) {
        const res = await this.searchDoctorsAndSpecialtiesUseCase.execute(dto, identity);
        return {
            success: true,
            data: {
                specialties: res.data.specialties.slice(0, 5).map((s) => ({
                    id: s.id,
                    name: s.name,
                    type: 'specialty',
                })),
                doctors: res.data.doctors.slice(0, 5).map((d) => ({
                    id: d.id,
                    fullName: d.fullName,
                    title: d.title,
                    specialtyName: d.specialtyName,
                    photoUrl: d.photoUrl,
                    averageRating: d.averageRating,
                    type: 'doctor',
                })),
            },
            metadata: res.metadata,
        };
    }
}
