export enum CompletionDecision {
  NOT_DUE = 'NOT_DUE',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
}

export const NO_SHOW_GRACE_MINUTES = 120;

export function decideCompletion(startsAt: Date, now: Date = new Date()): CompletionDecision {
  const msPast = now.getTime() - startsAt.getTime();
  if (msPast < 0) return CompletionDecision.NOT_DUE;
  const graceMs = NO_SHOW_GRACE_MINUTES * 60 * 1000;
  return msPast <= graceMs ? CompletionDecision.COMPLETED : CompletionDecision.NO_SHOW;
}
