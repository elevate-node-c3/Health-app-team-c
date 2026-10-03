# HATC-24 — Rescheduling (BOOK-7) — PLAN.md

**Story:** BOOK-7 Rescheduling — moving an appointment without opening a loophole (3 pts, Priority High)
**Source:** `sprint-3-booking-stories.md` BOOK-7 + `requirements.md` BR-25, D2, BR-11, BR-23–BR-26
**Blocked:** No — hard prerequisites verified in codebase (see §0). Soft gaps are part of this plan.
**Mode:** standard, tracer-first

## 0. Pre-flight (research summary, 2026-10-03)

| Depends on | Status | Evidence |
|---|---|---|
| BOOK-1 availability | Done | `src/modules/catalog/use-case/get-doctor-availability.use-case.ts:25` Morning/Afternoon/Night, taken visible, Cairo tz, 60d window, inactive pairing → 404 |
| BOOK-2 hold + concurrency | Done | `src/modules/booking/entities/slot-hold.entity.ts:16` partial unique ACTIVE; `src/modules/booking/use-case/create-hold.use-case.ts:195` tx + `23505`→409; 10min + 5min extend; `release-expired-holds.use-case.ts:21` cron; `create-hold.concurrent.spec.ts:7` gated on `DB_HOST`/`DB_NAME` |
| BOOK-4 pay/confirm + appointment model | Done | `src/modules/payment/use-case/process-payment.use-case.ts:157` idempotency `PAY-hold-user`; `src/modules/catalog/entities/appointment.entity.ts:81` partial unique BOOKED; `src/modules/booking/helpers/create-appointment-from-hold.ts:16` |
| BOOK-6 24h rule | Done, reuse | `src/modules/booking/policies/cancellation-policy.ts:10` `>=24h=FREE`; `src/modules/booking/use-case/cancel-appointment.use-case.ts:38` row-lock + recompute at confirm + `OUTCOME_CHANGED`; `preview-cancellation.use-case.ts:42` |
| BOOK-5 history | Missing, soft | `src/modules/booking/booking.controller.ts` has only holds/preview/cancel. Reschedule needs only scoped fetch of own BOOKED row. |
| BOOK-8 reminders | Partial, soft | Release/refund crons + `APPOINTMENT_CANCELLED` consumer exist. No reminder scheduler. Reschedule publishes event only. |

Gaps this plan closes:
- `AppointmentEntity` has no `rescheduleCount`/`rescheduledAt` — cannot enforce "once" (BR-25/D2). Needs migration.
- `CreateHoldUseCase.assertNotBooked` ignores ACTIVE holds; reschedule must check both BOOKED + ACTIVE holds.
- Test hygiene (found 2026-10-03 run): `preview-cancellation.use-case.spec.ts:121` mixes UTC date + local time → flaky `FREE`/`NO_REFUND` at 00:00–03:00 Cairo; `cancel-appointment.use-case.spec.ts` fails to run, `stripe.service.ts:2` missing `node_modules/stripe` → run `npm install` before verify.

Decision: server recomputes 24h on ORIGINAL start at confirm time (same as BR-24 cancel). Post-move cancel uses NEW start (closes reschedule→cancel-free loophole). No charge, no refund. Same doctor/clinic only (DTO carries date/time only).

## 1. Goal

Patient moves an Upcoming appointment to a new genuinely-free time, atomically (old freed + new taken together, never both/neither), under the same 24h rule as cancel, at most once, with reminders following via event.

## 2. Scope fences

- In: `POST /api/v1/booking/appointments/:id/reschedule`, use-case, DTO, entity columns + migration, outbox `APPOINTMENT_RESCHEDULED`, unit + concurrent tests.
- Out: BOOK-5 list/history UI, BOOK-8 reminder rescheduler (consumes the event later), prescription, refund flow changes, `create-hold` refactor, payment hardening (note as follow-up).

## 3. Contracts

Request: `POST /api/v1/booking/appointments/:id/reschedule` `@Roles(PATIENT)` body `{ date: YYYY-MM-DD, newStartTime: HH:mm }` (whitelist; `doctorId`/`clinicId` rejected if sent).
Success 200: `{ appointmentId, oldDate, oldStartTime, date, startTime, endTime, rescheduleCount, rescheduledAt }`.
Errors (shared envelope, `messageKey: errors.…`): 404 `BOOKING_APPOINTMENT_NOT_FOUND` (incl. other-user rows — 404 not 403); 400 `BOOKING_RESCHEDULE_NOT_ALLOWED` (cancelled/completed/started); 422 `BOOKING_RESCHEDULE_TOO_LATE` (original <24h); 409 `BOOKING_RESCHEDULE_ALREADY_USED` (second attempt); 409 `BOOKING_SLOT_UNAVAILABLE` (new slot taken/held/past/schedule-changed).
Event: outbox `aggregateType=APPOINTMENT name=APPOINTMENT_RESCHEDULED exchange=appointment_exchange` payload `{ appointmentId, patientId, doctorId, clinicId, oldDate, oldStartTime, date, startTime, endTime, rescheduleCount, rescheduledAt }`. No reminder/notification calls inside use-case.

## 4. Tasks (tracer first)

### Task 1 — Tracer: happy-path move + event (production quality)
Files: `src/modules/catalog/entities/appointment.entity.ts` (+ migration), `src/modules/booking/dto/reschedule-appointment.dto.ts` (new), `src/modules/booking/use-case/reschedule-appointment.use-case.ts` (new), `src/modules/booking/booking.service.ts`, `src/modules/booking/booking.controller.ts`, `src/modules/booking/booking.module.ts`.
Logic:
1. `pessimistic_write` lock appointment; 404 if missing or `patientId` mismatch; refuse if `status != BOOKED` or `decideCancellation(getAppointmentStart(appt), now) == ALREADY_STARTED`.
2. 24h check on ORIGINAL start via `decideCancellation` (reuse `policies/cancellation-policy.ts` + `helpers/appiontment-time.ts` luxon Cairo). If `NO_REFUND` → 422.
3. Refuse if `rescheduleCount >= 1` → 409.
4. Load pairing for appointment's own `doctorId`/`clinicId` (same pattern as `create-hold.use-case.ts:81`); 404 if inactive/unverified.
5. Validate new slot: aligns with `pairing.schedule` slot grid, within 60d window, not past Cairo now, != old slot.
6. In same transaction: check new slot free — no `BOOKED` appointment (excluding self) + no unexpired `ACTIVE` hold; then update `date/startTime/endTime` (`endTime` = start + `slotDuration`), `rescheduleCount++`, `rescheduledAt=now`; catch `23505` → 409, original intact (rollback).
7. Save outbox event above in same tx. No payment/refund writes.
Verify: `npx jest src/modules/booking/use-case/reschedule-appointment.use-case.spec.ts --no-coverage` covers 30h→free move (old free, new taken), 6h→422, second attempt→409, no charge/refund assertions, different doctor/clinic rejected (DTO has no such fields), cancelled/completed→400. Fixtures MUST build Cairo date/time via luxon (see §0 flake — never `toISOString()+toTimeString()`).

### Task 2 — Edge + loophole tests
Files: same spec + `src/modules/booking/use-case/cancel-appointment.use-case.spec.ts` (read-only reference).
Cases: reschedule to 2h-away succeeds (original was 30h+), then `previewCancellation`/`cancel` on NEW start → `NO_REFUND` (proves D2 loophole closed); new slot taken in same instant → 409 and original row unchanged; schedule-changed/leave between picker and confirm → 404/409; past new time → 409.
Verify: same jest command; `fails_when`: non-zero exit or `Tests: .* failed`.

### Task 3 — Wiring, guards, docs
Files: controller route + `Roles(PATIENT)`, service delegate, module provider, error-code catalogue entry, `requirements.md D2` trace note.
Checks: guest → 403 + sign-in route hint (via `RolesGuard` deny-by-default); unverified phone → refused same as hold (BR-07); unknown fields rejected (`whitelist/forbidNonWhitelisted`).
Verify: `npm run lint`, `npm run build`, manual `curl` 404 on other-user id (must not leak 403).

## 5. Concurrency note (must implement, not comment)

Serialize on appointment row lock; new-slot contention resolved by `appointments` partial-unique BOOKED + `23505` catch. Reschedule-vs-`create-hold` shares no index — narrow window accepted (same as existing code); loser hold fails later at payment reconcile. Document in code comment (2 lines max). Concurrent test: two parallel reschedules of different appointments to same new slot (or reschedule vs seeded BOOKED) → exactly one wins; use fakes/clocks, plus DB-backed `23505` test pattern from `create-hold.concurrent.spec.ts` (gated on `DB_HOST`, never mocked).

## 6. Acceptance mapping (BOOK-7, all 8)

30h+free→moved+swap; 6h→24h refuse; 2nd→refused; no charge/refund; taken-instant→original intact; old reminder suppressed + new scheduled — via event only (BOOK-8 asserts, here assert event published + zero reminder imports in reschedule code via `grep -ri reminder src/modules/booking/use-case/reschedule`); different doctor/clinic→refused; cancelled/completed→refused.

## 7. Verify (run before done)

1. `npm install` (repairs missing `stripe` dep) then `npx jest src/modules/booking --no-coverage` — `fails_when`: non-zero exit or `failed` in summary.
2. `npm run lint` / `npm run build` — `fails_when`: non-zero exit.
3. DB-gated: `DB_HOST=… npx jest src/modules/booking/use-case/create-hold.concurrent.spec.ts` — still passes (no regression to BOOK-2 guarantee).

## 8. Risks

- Payment `preparePaymentIntent` does not re-check appointment-taken before charge — pre-existing BOOK-4 gap widened by reschedule; follow-up, not this plan.
- `cancel` controller does not yet forward `acknowledgedOutcome` — reschedule needs no preview, but keep error copy fair ("terms changed, please pick again").
- Timezone: all date/time math via `getAppointmentStart`/luxon Cairo; wall-clock `new Date()` only for `now`.
