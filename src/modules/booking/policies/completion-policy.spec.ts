import { CompletionDecision, decideCompletion } from './completion-policy';

describe('decideCompletion', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');
  const minusMs = (ms: number) => new Date(now.getTime() - ms);
  const plusMs = (ms: number) => new Date(now.getTime() + ms);
  const MIN = 60 * 1000;

  it('completes when start is exactly now', () => {
    expect(decideCompletion(now, now)).toBe(CompletionDecision.COMPLETED);
  });

  it('completes when start was 119 minutes ago', () => {
    expect(decideCompletion(minusMs(119 * MIN), now)).toBe(CompletionDecision.COMPLETED);
  });

  it('completes at exactly 120 minutes grace boundary', () => {
    expect(decideCompletion(minusMs(120 * MIN), now)).toBe(CompletionDecision.COMPLETED);
  });

  it('marks NO_SHOW when start was 121 minutes ago', () => {
    expect(decideCompletion(minusMs(121 * MIN), now)).toBe(CompletionDecision.NO_SHOW);
  });

  it('stays NOT_DUE for future start', () => {
    expect(decideCompletion(plusMs(60 * MIN), now)).toBe(CompletionDecision.NOT_DUE);
  });
});
