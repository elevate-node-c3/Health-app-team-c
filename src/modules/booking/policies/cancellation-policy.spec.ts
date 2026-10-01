import { CancellationDecision, decideCancellation } from './cancellation-policy';

describe('decideCancellation', () => {
    const now = new Date('2026-10-01T10:00:00.000Z');
    const plusMs = (ms: number) => new Date(now.getTime() + ms);
    const HOUR = 60 * 60 * 1000;

    it('is FREE when far more than 24h away', () => {
        expect(decideCancellation(plusMs(48 * HOUR), now)).toBe(CancellationDecision.FREE);
    });

    it('is FREE exactly at the 24h boundary', () => {
        expect(decideCancellation(plusMs(24 * HOUR), now)).toBe(CancellationDecision.FREE);
    });

    it('is NO_REFUND one millisecond inside the window', () => {
        expect(decideCancellation(plusMs(24 * HOUR - 1), now)).toBe(CancellationDecision.NO_REFUND);
    });

    it('is NO_REFUND at 23h58m (the dialog said free at 24h05m)', () => {
        expect(decideCancellation(plusMs(23 * HOUR + 58 * 60 * 1000), now)).toBe(
            CancellationDecision.NO_REFUND,
        );
    });

    it('is NO_REFUND one minute before start', () => {
        expect(decideCancellation(plusMs(60 * 1000), now)).toBe(CancellationDecision.NO_REFUND);
    });

    it('is ALREADY_STARTED exactly at start time', () => {
        expect(decideCancellation(plusMs(0), now)).toBe(CancellationDecision.ALREADY_STARTED);
    });

    it('is ALREADY_STARTED after start time', () => {
        expect(decideCancellation(plusMs(-HOUR), now)).toBe(CancellationDecision.ALREADY_STARTED);
    });
});