export enum CancellationDecision {
    FREE = 'FREE',
    NO_REFUND = 'NO_REFUND',
    ALREADY_STARTED = 'ALREADY_STARTED',
}

export const FREE_CANCELLATION_WINDOW_HOURS = 24;


export function decideCancellation(startsAt: Date, now: Date = new Date()): CancellationDecision {
    const msLeft = startsAt.getTime() - now.getTime();

    if (msLeft <= 0) return CancellationDecision.ALREADY_STARTED;

    const windowMs = FREE_CANCELLATION_WINDOW_HOURS * 60 * 60 * 1000;
    return msLeft >= windowMs ? CancellationDecision.FREE : CancellationDecision.NO_REFUND;
}