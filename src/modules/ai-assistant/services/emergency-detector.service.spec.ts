import { Test, TestingModule } from '@nestjs/testing';
import { EmergencyDetectorService } from './emergency-detector.service';
import * as emergencyConfig from '../config/emergency-rules.config';

jest.mock('../config/emergency-rules.config', () => {
    const actual = jest.requireActual('../config/emergency-rules.config');
    return {
        ...actual,
        compileEmergencyRules: jest.fn(),
        normalizeText: jest.fn((str: string) => (str ? str.toLowerCase().trim() : '')),
    };
});

describe('EmergencyDetectorService', () => {
    let service: EmergencyDetectorService;

    const mockRulesFile = {
        version: '1.2.0',
        reviewedBy: 'Dr. Triage',
        reviewedAt: '2026-05-01',
        emergencyNumber: '123',
        context: {
            dismissalMaxWords: 4,
        },
        responses: {
            CARDIAC: {
                ar: 'حالة طوارئ قلبية! اتصل بالرقم {{EMERGENCY_NUMBER}} فوراً.',
                en: 'Cardiac emergency! Call {{EMERGENCY_NUMBER}} immediately.',
            },
            DEFAULT: {
                ar: 'حالة طوارئ! اطلب {{EMERGENCY_NUMBER}} الآن.',
                en: 'Emergency! Call {{EMERGENCY_NUMBER}} now.',
            },
        },
    };

    const mockCompiledRules = {
        file: mockRulesFile,
        rules: [
            {
                rule: {
                    id: 'rule-cardiac',
                    category: 'CARDIAC',
                    priority: 1,
                    pastTenseDowngrade: true,
                },
                groups: [[/chest\s*pain|ألم\s*صدر/i]],
            },
            {
                rule: {
                    id: 'rule-breathing',
                    category: 'RESPIRATORY',
                    priority: 2,
                    pastTenseDowngrade: true,
                },
                groups: [[/shortness\s*of\s*breath|ضيق\s*تنفس/i]],
            },
            {
                rule: {
                    id: 'rule-severe-trauma',
                    category: 'TRAUMA',
                    priority: 3,
                    pastTenseDowngrade: false,
                },
                groups: [[/gunshot|طلق\s*ناري/i]],
            },
        ],
        past: [/last\s*year|yesterday|كان|السنة\s*اللي\s*فاتت/i],
        present: [/now|currently|دلوقتي|حاليا/i],
        dismissal: [/never\s*mind|forget\s*it|خلاص|سيبك/i],
    };

    beforeEach(async () => {
        (emergencyConfig.compileEmergencyRules as jest.Mock).mockReturnValue(mockCompiledRules);

        const module: TestingModule = await Test.createTestingModule({
            providers: [EmergencyDetectorService],
        }).compile();

        service = module.get<EmergencyDetectorService>(EmergencyDetectorService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('detectEmergency - Basic Detection & Priorities', () => {
        it('should return isEmergency: false when no emergency keywords are matched', () => {
            const result = service.detectEmergency('عندي صداع خفيف من الصبح');

            expect(result.isEmergency).toBe(false);
            expect(result.ruleTriggered).toBeUndefined();
            expect(result.language).toBe('ar');
            expect(result.rulesVersion).toBe('1.2.0');
        });

        it('should detect emergency, select highest priority rule (lowest number), and format override response', () => {
            const result = service.detectEmergency('I have severe chest pain and shortness of breath');

            expect(result.isEmergency).toBe(true);
            expect(result.ruleTriggered?.id).toBe('rule-cardiac');
            expect(result.ruleTriggered?.priority).toBe(1);
            expect(result.overrideResponse).toBe('Cardiac emergency! Call 123 immediately.');
            expect(result.language).toBe('en');
        });

        it('should use DEFAULT emergency template if category template is not found in file', () => {
            const result = service.detectEmergency('I have shortness of breath');

            expect(result.isEmergency).toBe(true);
            expect(result.ruleTriggered?.id).toBe('rule-breathing');
            expect(result.overrideResponse).toBe('Emergency! Call 123 now.');
        });
    });

    describe('detectEmergency - Past Tense Downgrade Logic', () => {
        it('should downgrade emergency if past keywords are present and no present tense indicators exist', () => {
            const result = service.detectEmergency('أبويا كان عنده ألم صدر السنة اللي فاتت');

            expect(result.isEmergency).toBe(false);
            expect(result.pastContextRule).toBeDefined();
            expect(result.pastContextRule?.id).toBe('rule-cardiac');
            expect(result.overrideResponse).toBeUndefined();
        });

        it('should NOT downgrade if present tense keywords are present alongside past tense', () => {
            const result = service.detectEmergency('كان عندي ألم صدر زمان ودلوقتي رجع تاني');

            expect(result.isEmergency).toBe(true);
            expect(result.ruleTriggered?.id).toBe('rule-cardiac');
            expect(result.overrideResponse).toContain('123');
        });

        it('should NOT downgrade even in past tense if the rule specifies pastTenseDowngrade: false', () => {
            const result = service.detectEmergency('He had a gunshot wound yesterday');

            expect(result.isEmergency).toBe(true);
            expect(result.ruleTriggered?.id).toBe('rule-severe-trauma');
        });
    });

    describe('detectLanguage', () => {
        it('should detect Arabic language when Arabic characters dominate', () => {
            const result = service.detectEmergency('أشعر بألم شديد');
            expect(result.language).toBe('ar');
        });

        it('should detect English when Latin characters dominate', () => {
            const result = service.detectEmergency('Severe pain in left arm');
            expect(result.language).toBe('en');
        });

        it('should default to Arabic when Arabic count is equal or greater than English', () => {
            const result = service.detectEmergency('ألم pain');
            expect(result.language).toBe('ar');
        });
    });

    describe('isDismissal', () => {
        it('should return true for valid dismissal phrases within word limit', () => {
            expect(service.isDismissal('خلاص سيبك')).toBe(true);
            expect(service.isDismissal('never mind')).toBe(true);
        });

        it('should return false if text exceeds dismissalMaxWords limit (4 words)', () => {
            expect(service.isDismissal('never mind forget it please now')).toBe(false);
        });

        it('should return false for regular messages that do not match dismissal keywords', () => {
            expect(service.isDismissal('أنا تعبان جداً')).toBe(false);
            expect(service.isDismissal('')).toBe(false);
        });
    });

    describe('matchedRuleIds helper', () => {
        it('should return all matching rule ids regardless of priorities or past tense rules', () => {
            const ids = service.matchedRuleIds('chest pain and shortness of breath');
            expect(ids).toEqual(['rule-cardiac', 'rule-breathing']);
        });

        it('should return an empty array when nothing matches', () => {
            const ids = service.matchedRuleIds('hello doctor');
            expect(ids).toEqual([]);
        });
    });

    describe('rulesVersion getter', () => {
        it('should expose the compiled rules file version', () => {
            expect(service.rulesVersion).toBe('1.2.0');
        });
    });
});