import { Injectable, Logger } from '@nestjs/common';
import {
    CompiledEmergencyRules,
    EMERGENCY_RULES_FILE,
    EmergencyLanguage,
    EmergencyRule,
    compileEmergencyRules,
    normalizeText,
} from '../config/emergency-rules.config';

export interface EmergencyCheckResult {
    isEmergency: boolean;

    ruleTriggered?: EmergencyRule;

    overrideResponse?: string;
    language: EmergencyLanguage;
    pastContextRule?: EmergencyRule;
    rulesVersion: string;
}

@Injectable()
export class EmergencyDetectorService {
    private readonly logger = new Logger(EmergencyDetectorService.name);
    private readonly compiled: CompiledEmergencyRules;

    constructor() {
        this.compiled = compileEmergencyRules(EMERGENCY_RULES_FILE);

        const { version, reviewedBy, reviewedAt } = this.compiled.file;
        if (!reviewedBy || !reviewedAt) {
            this.logger.warn(
                `Emergency rules v${version} have NOT been reviewed by a clinician (reviewedBy/reviewedAt missing).`,
            );
        } else {
            this.logger.log(`Emergency rules v${version} loaded (reviewed by ${reviewedBy} on ${reviewedAt}).`);
        }
    }

    public detectEmergency(userMessage: string): EmergencyCheckResult {
        const language = this.detectLanguage(userMessage);
        const rulesVersion = this.compiled.file.version;
        const text = normalizeText(userMessage ?? '');

        const hits = this.compiled.rules.filter((c) => this.ruleMatches(c.groups, text));
        if (!hits.length) {
            return { isEmergency: false, language, rulesVersion };
        }

        const hasPast = this.compiled.past.some((r) => r.test(text));
        const hasPresent = this.compiled.present.some((r) => r.test(text));

        const active = hits.filter((h) => !(h.rule.pastTenseDowngrade && hasPast && !hasPresent));
        const byPriority = (a: { rule: EmergencyRule }, b: { rule: EmergencyRule }) =>
            a.rule.priority - b.rule.priority;

        if (active.length) {
            const top = [...active].sort(byPriority)[0].rule;
            this.logger.warn(`[EMERGENCY DETECTED] rule=${top.id} category=${top.category} v${rulesVersion}`);
            return {
                isEmergency: true,
                ruleTriggered: top,
                overrideResponse: this.getEmergencyResponse(top.category, language),
                language,
                rulesVersion,
            };
        }

        const pastRule = [...hits].sort(byPriority)[0].rule;
        this.logger.log(`[Emergency keywords in past context] rule=${pastRule.id} v${rulesVersion}`);
        return { isEmergency: false, pastContextRule: pastRule, language, rulesVersion };
    }


    public isDismissal(userMessage: string): boolean {
        const text = normalizeText(userMessage ?? '');
        if (!text) return false;
        const words = text.split(' ').length;
        if (words > this.compiled.file.context.dismissalMaxWords) return false;
        return this.compiled.dismissal.some((r) => r.test(text));
    }

    public matchedRuleIds(userMessage: string): string[] {
        const text = normalizeText(userMessage ?? '');
        return this.compiled.rules.filter((c) => this.ruleMatches(c.groups, text)).map((c) => c.rule.id);
    }

    public get rulesVersion(): string {
        return this.compiled.file.version;
    }

    private ruleMatches(groups: RegExp[][], text: string): boolean {
        return groups.every((group) => group.some((re) => re.test(text)));
    }

    private detectLanguage(text: string): EmergencyLanguage {
        const arabic = (text?.match(/[\u0600-\u06FF]/g) ?? []).length;
        const latin = (text?.match(/[A-Za-z]/g) ?? []).length;
        return arabic > 0 && arabic >= latin ? 'ar' : 'en';
    }

    private getEmergencyResponse(category: string, language: EmergencyLanguage): string {
        const { responses, emergencyNumber } = this.compiled.file;
        const entry = responses[category] ?? responses['DEFAULT'];
        return entry[language].replace(/\{\{EMERGENCY_NUMBER\}\}/g, emergencyNumber);
    }
}