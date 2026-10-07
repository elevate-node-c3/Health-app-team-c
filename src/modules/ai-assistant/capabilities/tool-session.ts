import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { SpecialtySuggestion } from '../interfaces/specialty-suggestion.interface';


export interface ToolSession {
    readonly userContext: UserContext;
    readonly isGuest: boolean;
    specialtySuggestion: SpecialtySuggestion | null;

    readonly knownDoctors: Map<string, string>;
}

export function createToolSession(userContext: UserContext): ToolSession {
    return {
        userContext,
        isGuest: !userContext?.userId || userContext?.role === 'GUEST',
        specialtySuggestion: null,
        knownDoctors: new Map(),
    };
}