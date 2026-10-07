export const AI_POLICY_TOPICS = ['CANCELLATION', 'RESCHEDULING', 'BOOKING', 'PAYMENT'] as const;
export type AiPolicyTopic = (typeof AI_POLICY_TOPICS)[number];

export const AI_POLICIES: Record<AiPolicyTopic, { ar: string | null; en: string | null }> = {
    CANCELLATION: { ar: null, en: null },
    RESCHEDULING: { ar: null, en: null },
    BOOKING: { ar: null, en: null },
    PAYMENT: { ar: null, en: null },
};