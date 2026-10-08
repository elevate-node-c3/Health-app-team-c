# Go-live report (ENG-7)

Branch `ENG-7-go-live`. AC numbers refer to `sprint-4-engagement-stories.md` ENG-7.

## Commits

- `a0eae67` Task 0: honesty + security fixes (10 files, spec renames included)
- `c4ec7aa` Task 1: `docs/event-catalogue.md` (27 outbox + 4 analytics rows)
- `fc37873` Task 2: `DemoSeeder`, `run-seed` wiring, DB-gated idempotency spec
- `e78050e` Task 3: `docs/design-decisions.md`, `docs/demo-script.md`
- `8f80596` Task 4: replay/consumer-off proofs, scoping specs, forged-token fix

No `.planning` file is tracked. `EVENT-AUDIT.md` working notes were removed;
the catalogue is the record.

## Verification evidence

- Task 0/4 specs green: interceptor 2/2, controller + purge 11/11, tracer +
  orphan 7/7, service scoping 7/7, booking roles 1/1, go-live verification 4/4.
- `tsc --noEmit --skipLibCheck` clean in all touched files. `npm run build`
  fails only on pre-existing missing `openai` types
  (`ai-provider.service.ts:3`), unrelated to this branch.
- Catalogue reconciliation: 31 distinct published `eventType` in non-spec
  source = 31 catalogue rows. Spot-checked 3 rows against code.
- Mutation: `cancellation-policy.ts:16` `>=` → `>` makes
  `decideCancellation is FREE exactly at the 24h boundary` fail (1 failed, 6
  passed); reverted. Breaking the rule fails a test (AC-9).
- Replay: PRESCRIPTION_ISSUED / REFUND_ISSUED / APPOINTMENT_BOOKED delivered
  twice with the same `x-event-id` produce one outcome each (AC-4).
- Consumer-off: booking use-case commits and leaves the outbox row pending
  when publish fails (AC-3).
- DB-gated specs (hold concurrency, attach concurrency, demo seed) skip
  without `DB_HOST`/`DB_NAME` and run for real with them.

## Secrets scan (AC-6)

- `git log -p --all -S "sk-ant-" / -S "sk_live"`: no hits.
- `git log --all -S "BEGIN RSA PRIVATE KEY" / "BEGIN PRIVATE KEY"`: no hits.
- 13+ digit number hunt: one hit, migration timestamp `1790985600000`
  (false positive, not a PAN).
- Working tree `src` grep for provider-key / private-key / card patterns: clean.
- No `gitleaks`/`trufflehog` binary on this machine; scan done with the git
  commands above. `.env` is git-ignored and untracked; `.env.example` holds
  empty placeholders only; `/storage` is ignored.
- No real PII seeded: demo identity is fictional (`demo@docura.eg`).

## Clean-clone run (AC-1, AC-2)

- `docker compose config` validates (one obsolete-`version` warning, harmless).
- `docker compose up --build` attempted 2026-10-08: daemon unreachable
  (`npipe:////./pipe/dockerDesktopLinuxEngine` not found, exit 1), so the
  live clone-to-journey run could not execute on this machine.
- To complete AC-1/AC-2: start Docker Desktop, then
  `docker compose down -v && docker compose up --build`, follow
  `docs/demo-script.md` with `demo@docura.eg` / `Demo1234!`, and append the
  seeder exit code plus step results here.

## Known gaps (not claimed as done)

1. OTP resend pacing (60s, 3/code, 5/hour) and 15-min sign-in lockout are not
   enforced in code (D4 partial). 5-attempt kill + 3-min expiry are.
2. Today/tomorrow availability filters match schedule days, not free-slot
   fullness (`apply-doctor-filters.ts:108-122`); fully-booked exclusion is not
   implemented.
3. Publish sites without `exchange` never publish (processor skips):
   `session.ended`, `session.theft_detected`, `slot.held`, `doctor.favorited`,
   `doctor.unfavorited`, 4 analytics events. Flagged in the catalogue.
4. `PATIENT_ACCOUNT_DELETED` is consumed but never published.
