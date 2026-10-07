import rulesFile from './emergency-rules.v1.json';

export type EmergencyLanguage = 'ar' | 'en';

export interface EmergencyRule {
    id: string;
    category: string;
    priority: number;
    pastTenseDowngrade: boolean;
    groups: string[][];
    positiveExamples: string[];
    negativeExamples: string[];
}

export interface EmergencyRulesFile {
    version: string;
    status: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    emergencyNumber: string;
    definitions: Record<string, string>;
    context: {
        pastMarkers: string[];
        presentMarkers: string[];
        dismissalMaxWords: number;
        dismissalPatterns: string[];
    };
    responses: Record<string, Record<EmergencyLanguage, string>>;
    rules: EmergencyRule[];
}

export interface CompiledEmergencyRule {
    rule: EmergencyRule;
    groups: RegExp[][];
}

export interface CompiledEmergencyRules {
    file: EmergencyRulesFile;
    rules: CompiledEmergencyRule[];
    past: RegExp[];
    present: RegExp[];
    dismissal: RegExp[];
}

export const EMERGENCY_RULES_FILE = rulesFile as unknown as EmergencyRulesFile;

export function normalizeArabic(s: string): string {
    return s
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
        .replace(/\u0640/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/([\u0621-\u064A])\1+/g, '$1');
}

export function normalizeText(text: string): string {
    return normalizeArabic(text.normalize('NFKC'))
        .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
        .toLowerCase()
        .replace(/['’‘`´]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function expandMacros(src: string, defs: Record<string, string>): string {
    let out = src;
    for (let i = 0; i < 6; i++) {
        const next = out.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
            if (!(key in defs)) {
                throw new Error(`Emergency rules: unknown macro {{${key}}} in pattern "${src}"`);
            }
            return defs[key];
        });
        if (next === out) return out;
        out = next;
    }
    throw new Error(`Emergency rules: macro expansion did not converge for "${src}"`);
}

function compilePattern(src: string, defs: Record<string, string>, where: string): RegExp {
    try {
        return new RegExp(normalizeArabic(expandMacros(src, defs)), 'iu');
    } catch (e: any) {
        throw new Error(`Emergency rules: invalid pattern in ${where}: ${src} (${e.message})`);
    }
}

export function compileEmergencyRules(file: EmergencyRulesFile): CompiledEmergencyRules {
    const defs = file.definitions;
    const seenIds = new Set<string>();

    const rules = file.rules.map((rule) => {
        if (seenIds.has(rule.id)) throw new Error(`Emergency rules: duplicate id ${rule.id}`);
        seenIds.add(rule.id);

        if (typeof rule.priority !== 'number') {
            throw new Error(`Emergency rules: ${rule.id} has no numeric priority`);
        }
        if (!rule.groups?.length || rule.groups.some((g) => !g.length)) {
            throw new Error(`Emergency rules: ${rule.id} has an empty pattern group`);
        }
        if (!file.responses[rule.category]) {
            throw new Error(`Emergency rules: no response defined for category ${rule.category}`);
        }

        return {
            rule,
            groups: rule.groups.map((g, gi) =>
                g.map((p, pi) => compilePattern(p, defs, `${rule.id} group ${gi} pattern ${pi}`)),
            ),
        };
    });

    const list = (arr: string[], name: string) =>
        arr.map((p, i) => compilePattern(p, defs, `${name}[${i}]`));

    return {
        file,
        rules,
        past: list(file.context.pastMarkers, 'pastMarkers'),
        present: list(file.context.presentMarkers, 'presentMarkers'),
        dismissal: list(file.context.dismissalPatterns, 'dismissalPatterns'),
    };
}