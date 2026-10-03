# HATC-24 Reschedule — FIX-PLAN.md

**Source:** `.planning/phases/hatc-24-reschedule/PLAN.md` (BOOK-7, 3 pts, Priority High)
**Branch:** `feat/reschedule-appointment`
**Scope:** Close gaps between implemented diff and primary PLAN §§1–8. No behavior change to happy path.

## 0. Baseline (verified 2026-10-03)

| Area | Status | Evidence |
|---|---|---|
| Entity columns | Done, no migration | `src/modules/catalog/entities/appointment.entity.ts:75` `rescheduleCount` + `rescheduledAt`; `src/database/migrations/**` empty; `src/database/database.module.ts:13` removed `synchronize:true`, `src/config/typeorm.config.ts:14` relies on `DB_SYNC` |
| Route/wiring | Done | `src/modules/booking/booking.controller.ts:43` `POST appointments/:id/reschedule` + `@Roles(PATIENT)`; `booking.service.ts`, `booking.module.ts` delegate/provider present |
| Use-case core | Done | `src/modules/booking/use-case/reschedule-appointment.use-case.ts:41` row lock, 404/400/422/409, same-pairing check, BOOKED-excluding-self + ACTIVE-hold check, `23505`→409, outbox in tx, no payment/refund, no `reminder` imports |
| DTO | Done | `src/modules/booking/dto/reschedule-appointment.dto.ts:1` `{date, newStartTime}` only |
| Outbox shape | Done | `aggregateType=APPOINTMENT`, `exchange=appointment_exchange`, `eventType=APPOINTMENT_RESCHEDULED`, payload has old/new + count fields; matches `OutboxEventEntity` (`aggregateType/eventType/exchange/payload`) |
| Spec hygiene | Done | `reschedule-appointment.use-case.spec.ts:17` luxon Cairo fixtures, 10 cases pass pattern |
| Loophole proof | Missing | No `30h→2h then preview/cancel on NEW start → NO_REFUND` test (PLAN Task2, Acceptance D2) |
| Past/leave/completed/started | Missing | Spec lacks past→409, leave/schedule-changed→404/409, `COMPLETED`/`ALREADY_STARTED`→400 |
| Concurrent proof | Missing | No `reschedule.concurrent.spec.ts`; no 2-line window comment (PLAN §5) |
| Error catalogue + D2 trace | Missing | Extra codes `SAME_SLOT`/`SLOT_NOT_FOUND`/`INVALID_SLOT` not in PLAN §3; no catalogue entry, no `requirements.md D2` note |
| Time consistency | Drift | `execute` uses `new Date()` while `assertNewSlotValid` uses `cairoNow()` via `toLocaleString`; `maxDate.setDate` in system tz; `weekday%7` vs `create-hold.use-case.ts:137` `getDay()` (PLAN §8) |
| Drive-bys | Noted | `database.module.ts`, `preview-cancellation.use-case.ts`, `cancel-appointment.use-case.spec.ts` comment-only changes |

## 1. Goal

Bring implementation to full PLAN compliance: prod-safe migration, contract-aligned errors, Cairo-consistent time, Task2 loophole/edge coverage, §5 concurrency proof, Task3 docs. Happy-path logic unchanged.

## 2. Tasks

### F1 — Migration (blocks prod, PLAN §Task1)
Files:
- New: `src/database/migrations/<timestamp>-add-reschedule-columns.ts`
- Edit: `src/config/typeorm.config.ts`, `package.json` (typeorm script)

Logic:
1. Migration `up`: `ALTER TABLE appointments ADD rescheduleCount int NOT NULL DEFAULT 0`, `ADD rescheduledAt timestamptz NULL`. `down`: drop both.
2. Wire `migrations: [dist/database/migrations/*.js]` + `migrationsRun: false` in `typeorm.config.ts` (dev keeps `DB_SYNC=true`, prod runs migrations).
3. Add `npm run migration:run` / `migration:generate` scripts per installed `typeorm@0.3.31`.
4. Do not revert `database.module.ts` change; do not re-enable `synchronize:true` in prod.

Verify: `npm run build` passes; `git status --short` shows one new migration file; `grep -r rescheduleCount src/database/migrations` hits.

### F2 — Contract alignment (PLAN §§3–4, Task3)
Files:
- `src/modules/booking/use-case/reschedule-appointment.use-case.ts`
- Error-code catalogue (wherever `BOOKING_SLOT_UNAVAILABLE` is documented; if none, add to booking module README or `src/common/` errors file — create only if missing)
- `requirements.md` D2 trace note

Logic:
1. Keep codes: `BOOKING_APPOINTMENT_NOT_FOUND` (404 incl. other-user), `BOOKING_RESCHEDULE_NOT_ALLOWED` (400 cancelled/completed/started), `BOOKING_RESCHEDULE_TOO_LATE` (422 original <24h), `BOOKING_RESCHEDULE_ALREADY_USED` (409 second attempt), `BOOKING_SLOT_UNAVAILABLE` (409 taken/held/past).
2. Document extras as allowed extensions (same pattern as `create-hold.use-case.ts:95`): `BOOKING_SLOT_NOT_FOUND` (404 pairing inactive/unverified/leave), `BOOKING_INVALID_SLOT` (400 grid/window violation), `BOOKING_RESCHEDULE_SAME_SLOT` (400 same slot).
3. Add catalogue entries + `requirements.md` D2 line: `reschedule recomputes 24h on ORIGINAL start; post-move cancel uses NEW start`.

Verify: `grep -rn BOOKING_RESCHEDULE_SAME_SLOT src` hits catalogue + use-case; `npm run lint` passes.

### F3 — Timezone cleanup (PLAN §8)
Files: `src/modules/booking/use-case/reschedule-appointment.use-case.ts`

Logic:
1. Single `now = DateTime.now().setZone(CLINIC_TZ)` source; `nowJS = now.toJSDate()` for `decideCancellation(getAppointmentStart(appt), nowJS)` + `rescheduledAt` + hold-expiry compare.
2. `assertNewSlotValid`: parse `dto.date` with `DateTime.fromISO(dto.date, {zone: CLINIC_TZ})`; `todayStr = DateTime.now().setZone(CLINIC_TZ).toFormat('yyyy-MM-dd')`; `maxDate = now.plus({days: 60})`; same-day past check compares minutes against Cairo `now.hour*60+now.minute`.
3. Align weekday mapping with `create-hold` (`Sun..Sat` tokens) and keep `slotDuration` fallback `30`; keep `generateSlots`/`addMinutes` pure.
4. Keep `startTime` save format (`HH:mm`) — note Postgres `time` normalizes to `HH:mm:ss` on read; existing `substring(0,5)` compares already handle this.

Verify: `npx jest src/modules/booking/use-case/reschedule-appointment.use-case.spec.ts --no-coverage` green; midnight-Cairo edge (00:00–03:00) no longer flips `FREE`/`NO_REFUND`.

### F4 — Task2 edge + loophole tests
Files: `src/modules/booking/use-case/reschedule-appointment.use-case.spec.ts` (extend only; `cancel-appointment.use-case.spec.ts` read-only reference)

Cases (all with luxon Cairo fixtures, never `toISOString()+toTimeString()`):
1. `30h+ → 2h-away` move succeeds, then `decideCancellation(getAppointmentStart(moved), now)` / `previewCancellation` on NEW start → `NO_REFUND` (D2 loophole closed).
2. Past new time → 409, original row unchanged (`savedAppointment` null, no outbox event).
3. Leave date / schedule-changed (pairing mock with `leaves: [dto.date]` or missing day) → 404/409.
4. `COMPLETED` + `ALREADY_STARTED` → 400.
5. Keep existing: 48h→free move, 6h→422, second→409, null-count→1, other-user→404, cancelled→400, same-slot→`SAME_SLOT`, taken→409 intact, live-hold→409 intact, `23505`→409 no event.

Verify: `npx jest src/modules/booking/use-case/reschedule-appointment.use-case.spec.ts --no-coverage`; `fails_when`: non-zero exit or `failed` in summary.

### F5 — Concurrency proof (PLAN §5, must implement not comment)
Files:
- `src/modules/booking/use-case/reschedule-appointment.use-case.ts` (2-line comment max)
- New: `src/modules/booking/use-case/reschedule.concurrent.spec.ts` (DB-gated, never mocked)

Logic:
1. Comment at save block: appointment row lock serializes same-row moves; new-slot contention resolved by partial-unique BOOKED + `23505` catch; reschedule-vs-`create-hold` shares no index — loser fails at payment reconcile (same as existing code).
2. Test: two parallel reschedules of different appointments to same new slot (or reschedule vs seeded BOOKED) → exactly one wins; pattern from `create-hold.concurrent.spec.ts` (skip unless `DB_HOST`/`DB_NAME` set, expect `23505` for loser).

Verify: unit run green without DB (skipped); `DB_HOST=… npx jest src/modules/booking/use-case/reschedule.concurrent.spec.ts` → exactly-one-wins; existing `create-hold.concurrent.spec.ts` still passes.

## 3. Acceptance mapping (BOOK-7, all 8)

30h+free→moved+swap; 6h→24h refuse; 2nd→refused; no charge/refund (assert no payment writes + no refund fields); taken-instant→original intact; old reminder suppressed + new scheduled — via event only (`APPOINTMENT_RESCHEDULED` published + `grep -ri reminder src/modules/booking/use-case/reschedule` empty); different doctor/clinic→refused (DTO has no such fields, whitelist rejects); cancelled/completed→refused.

## 4. Verify (run before done)

1. `npm install` (repairs missing `stripe` dep noted in PLAN §0) then `npx jest src/modules/booking --no-coverage` — `fails_when`: non-zero exit or `failed`.
2. `npm run lint` / `npm run build` — `fails_when`: non-zero exit.
3. DB-gated: `DB_HOST=… npx jest src/modules/booking/use-case/create-hold.concurrent.spec.ts` — still passes.

## 5. Risks

- Payment `preparePaymentIntent` does not re-check appointment-taken before charge — pre-existing BOOK-4 gap widened by reschedule; follow-up, not this fix.
- `HH:mm` vs `HH:mm:ss` normalization on `time` columns — compares use `substring(0,5)`, safe but keep on reads.
