export interface AiCompletionMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface AiCompletionResponse {
    fullText: string;
    specialtySuggestion: any | null;
    tokensIn: number;
    tokensOut: number;
}

export interface IAiProvider {
    streamCompletion(
        messages: AiCompletionMessage[],
        onChunk: (chunk: string) => void,
    ): Promise<AiCompletionResponse>;
}