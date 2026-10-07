export class ToolArgsError extends Error {
    constructor(public readonly field: string) {
        super(`Invalid argument: ${field}`);
        this.name = 'ToolArgsError';
    }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseArgsObject(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function optionalString(obj: Record<string, unknown>, key: string, maxLength = 100): string | undefined {
    const v = obj[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') throw new ToolArgsError(key);
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLength) throw new ToolArgsError(key);
    return trimmed;
}

export function requiredString(obj: Record<string, unknown>, key: string, maxLength = 100): string {
    const v = optionalString(obj, key, maxLength);
    if (v === undefined) throw new ToolArgsError(key);
    return v;
}

export function requiredUuid(obj: Record<string, unknown>, key: string): string {
    const v = requiredString(obj, key, 36);
    if (!UUID_RE.test(v)) throw new ToolArgsError(key);
    return v.toLowerCase();
}

export function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}

const NAME_TITLES = new Set(['dr', 'doctor', 'prof', 'د', 'دكتور', 'دكتوره', 'الدكتور', 'الدكتوره']);


export function nameTokens(name: string | undefined, max = 5): string[] {
    if (!name) return [];
    return name
        .split(/\s+/)
        .map((t) => t.replace(/^[.,،:;"'()]+|[.,،:;"'()]+$/g, ''))
        .filter((t) => t.length > 0 && !NAME_TITLES.has(t.toLowerCase()))
        .slice(0, max);
}