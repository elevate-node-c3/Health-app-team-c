import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CapabilityExecutorService } from './capability-executor.service';
import { buildToolDefinitions } from '../config/ai-tools.config';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { AiProviderError } from '../errors/ai-provider.error';
import { createToolSession, ToolSession } from '../capabilities/tool-session';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string | null;
    tool_call_id?: string;
    tool_calls?: any[];
}

export interface StreamResponse {
    fullText: string;
    specialtySuggestion: any | null;
    tokensIn: number;
    tokensOut: number;
    model: string;
    finishReason: string | null;
}

export interface StreamAnswerOptions {
    maxTokens?: number;
}

interface PendingToolCall {
    id: string;
    name: string;
    args: string;
}

const MAX_TOOL_ROUNDS = 3;
const TOOL_TIMEOUT_MS = 8_000;
const OVERALL_DEADLINE_MS = 60_000;
const MAX_TOOL_RESULT_CHARS = 8_000;

@Injectable()
export class AiProviderService {
    private readonly logger = new Logger(AiProviderService.name);
    private readonly openai: OpenAI;
    private readonly model: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly capabilityExecutor: CapabilityExecutorService,
    ) {
        this.openai = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: this.configService.get<string>('OPENAI_API_KEY'),
            maxRetries: 1,
        });
        this.model = this.configService.get<string>('AI_MODEL') ?? 'gpt-4o-mini';
    }

    private readonly systemPrompt = `
You are a medical triage and clinic assistant. 

CRITICAL RULES:
1. Always respond in the EXACT SAME LANGUAGE as the patient message (Arabic if input is Arabic, English if English).
2. Never give a final medical diagnosis.
3. Keep the answer brief, supportive, and professional.
4. You HAVE ACCESS to real system tools: list_specialties, suggest_specialty, search_doctors, get_availability, get_policy, and (for signed-in users only) get_my_appointments.
5. If the user asks about their personal appointments, call 'get_my_appointments'. Never ask for or pass any user id.
6. If the user asks for doctor recommendations or search, call 'search_doctors'.
7. Never invent doctor names, fees, clinics, times or policies. Only state what a tool returned. If a tool returns nothing, say so honestly and suggest a broader search or a related specialty.
8. When you identify which specialty treats the problem, call 'suggest_specialty' once (use list_specialties first if you are unsure of the exact name). Do NOT write any JSON or tags about the specialty in your answer text.
9. You can only suggest booking, cancelling or rescheduling. You never do any of them.
`;

    private buildSystemPrompt(session: ToolSession): string {
        return session.isGuest
            ? this.systemPrompt +
            '\nThe current user is a GUEST (not signed in). You cannot access appointments. If they ask about their own appointments, politely ask them to sign in.\n'
            : this.systemPrompt;
    }

    async streamAnswer(
        messages: ChatMessage[],
        userContext: UserContext,
        onChunk: (chunkText: string) => void,
        options?: StreamAnswerOptions,
    ): Promise<StreamResponse> {
        let fullText = '';
        let tokensIn = 0;
        let tokensOut = 0;
        let lastFinishReason: string | null = null;

        const session = createToolSession(userContext);
        const tools = buildToolDefinitions({ isGuest: session.isGuest });

        const conversation: any[] = [
            { role: 'system', content: this.buildSystemPrompt(session) },
            ...messages.map((m) => ({
                role: m.role,
                content: m.content ?? '',
                ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
                ...(m.tool_calls && { tool_calls: m.tool_calls }),
            })),
        ];

        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), OVERALL_DEADLINE_MS);

        try {
            for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
                const allowTools = round < MAX_TOOL_ROUNDS;

                const stream = await this.openai.chat.completions.create(
                    {
                        model: this.model,
                        messages: conversation,
                        tools: tools as any,
                        tool_choice: allowTools ? 'auto' : 'none',
                        stream: true,
                        stream_options: { include_usage: true },
                        ...(options?.maxTokens && { max_tokens: options.maxTokens }),
                    },
                    { signal: controller.signal },
                );

                let roundText = '';
                let finishReason: string | null = null;
                const calls = new Map<number, PendingToolCall>();

                for await (const chunk of stream) {
                    if (chunk.usage) {
                        tokensIn += chunk.usage.prompt_tokens || 0;
                        tokensOut += chunk.usage.completion_tokens || 0;
                    }

                    const choice = chunk.choices?.[0];
                    if (!choice) continue;

                    const delta: any = choice.delta;
                    if (delta?.refusal) throw new AiProviderError('PROVIDER_REFUSED');

                    if (delta?.content) {
                        roundText += delta.content;
                        fullText += delta.content;
                        onChunk(delta.content);
                    }

                    for (const tc of delta?.tool_calls ?? []) {
                        const entry = calls.get(tc.index) ?? { id: '', name: '', args: '' };
                        if (tc.id) entry.id = tc.id;
                        if (tc.function?.name) entry.name = tc.function.name;
                        if (tc.function?.arguments) entry.args += tc.function.arguments;
                        calls.set(tc.index, entry);
                    }

                    if (choice.finish_reason) finishReason = choice.finish_reason;
                }

                lastFinishReason = finishReason;
                if (finishReason === 'content_filter') throw new AiProviderError('PROVIDER_REFUSED');

                const pending = [...calls.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([, v]) => v)
                    .filter((c) => c.id && c.name);

                if (!pending.length || !allowTools) break;

                conversation.push({
                    role: 'assistant',
                    content: roundText || null,
                    tool_calls: pending.map((c) => ({
                        id: c.id,
                        type: 'function',
                        function: { name: c.name, arguments: c.args || '{}' },
                    })),
                });

                const results = await Promise.all(pending.map((c) => this.runTool(c, session)));
                pending.forEach((c, i) => {
                    conversation.push({
                        role: 'tool',
                        tool_call_id: c.id,
                        content: this.serializeToolResult(results[i]),
                    });
                });
            }

            if (!fullText.trim()) throw new AiProviderError('PROVIDER_BAD_RESPONSE');

            return {
                fullText: this.cleanText(fullText),
                specialtySuggestion: session.specialtySuggestion ?? this.parseSpecialty(fullText),
                tokensIn,
                tokensOut,
                model: this.model,
                finishReason: lastFinishReason,
            };
        } catch (error) {
            throw this.classifyError(error);
        } finally {
            clearTimeout(deadline);
        }
    }

    private async runTool(call: PendingToolCall, session: ToolSession): Promise<unknown> {
        let args: unknown;
        try {
            args = JSON.parse(call.args || '{}');
        } catch {
            return { error: 'INVALID_ARGUMENTS' };
        }

        try {
            return await this.withTimeout(
                this.capabilityExecutor.executeTool(call.name, args, session),
                TOOL_TIMEOUT_MS,
            );
        } catch (err: any) {
            this.logger.warn(`Tool ${call.name} failed: ${err?.message ?? 'unknown'}`);
            return { error: 'TOOL_UNAVAILABLE' };
        }
    }

    private serializeToolResult(result: unknown): string {
        const json = JSON.stringify(result ?? null);
        return json.length > MAX_TOOL_RESULT_CHARS ? json.slice(0, MAX_TOOL_RESULT_CHARS) : json;
    }

    private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        let timer: NodeJS.Timeout;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('TOOL_TIMEOUT')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    private classifyError(error: any): AiProviderError {
        if (error instanceof AiProviderError) return error;

        const name: string = error?.name ?? '';
        const status: number | undefined = error?.status;
        const code: string = String(error?.code ?? error?.error?.code ?? '');

        let result: AiProviderError;
        if (name === 'AbortError' || name === 'APIUserAbortError' || name === 'APIConnectionTimeoutError') {
            result = new AiProviderError('PROVIDER_TIMEOUT', error);
        } else if (status === 429) {
            result = new AiProviderError('PROVIDER_BUSY', error);
        } else if (code.includes('content_filter') || code.includes('content_policy')) {
            result = new AiProviderError('PROVIDER_REFUSED', error);
        } else {
            result = new AiProviderError('PROVIDER_ERROR', error);
        }

        this.logger.error(`AI provider failure: ${result.code} (status=${status ?? 'n/a'}, name=${name || 'n/a'})`);
        return result;
    }

    private parseSpecialty(text: string): any | null {
        const match = text.match(/<SPECIALTY>([\s\S]*?)<\/SPECIALTY>/);
        if (!match) return null;
        try {
            return JSON.parse(match[1].trim());
        } catch {
            return null;
        }
    }

    private cleanText(text: string): string {
        return text.replace(/<SPECIALTY>[\s\S]*?<\/SPECIALTY>/, '').trim();
    }
}