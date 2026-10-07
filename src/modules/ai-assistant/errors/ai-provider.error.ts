export type AiErrorCode =
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_BUSY'
    | 'PROVIDER_REFUSED'
    | 'PROVIDER_BAD_RESPONSE'
    | 'PROVIDER_ERROR'
    | 'GENERATION_INTERRUPTED';

export const AI_ERROR_PUBLIC: Record<AiErrorCode, { messageKey: string; message: string }> = {
    PROVIDER_TIMEOUT: {
        messageKey: 'errors.ai.timeout',
        message: 'The assistant is taking too long to answer. Please try again.',
    },
    PROVIDER_BUSY: {
        messageKey: 'errors.ai.busy',
        message: 'The assistant is busy right now. Please try again in a moment.',
    },
    PROVIDER_REFUSED: {
        messageKey: 'errors.ai.refused',
        message: "I can't help with that request. Please rephrase it or speak to a doctor directly.",
    },
    PROVIDER_BAD_RESPONSE: {
        messageKey: 'errors.ai.unavailable',
        message: 'The assistant is temporarily unavailable. Please try again later.',
    },
    PROVIDER_ERROR: {
        messageKey: 'errors.ai.unavailable',
        message: 'The assistant is temporarily unavailable. Please try again later.',
    },
    GENERATION_INTERRUPTED: {
        messageKey: 'errors.ai.interrupted',
        message: 'The answer was interrupted. Please try again.',
    },
};

export class AiProviderError extends Error {
    constructor(
        public readonly code: AiErrorCode,
        public readonly original?: unknown,
    ) {
        super(code);
        this.name = 'AiProviderError';
    }
}

export function toAiErrorCode(err: unknown): AiErrorCode {
    return err instanceof AiProviderError ? err.code : 'PROVIDER_ERROR';
}