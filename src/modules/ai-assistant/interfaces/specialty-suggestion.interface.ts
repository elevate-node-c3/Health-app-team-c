export interface SpecialtySuggestion {
    specialtyId: string;
    specialtyName: string;
    nearMe: boolean;
    availableSoon: boolean;
}

export interface AiStreamChunk {
    contentChunk: string;
    specialtySuggestion?: SpecialtySuggestion;
}