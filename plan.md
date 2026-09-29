# BOOK-2 Plan — Holding a slot while the user pays

## 0. Goal

A verified patient can hold a free slot for 10 minutes (extendable once by 5
minutes for 3-D Secure) with the price frozen, such that two simultaneous
requests yield exactly one winner, abandoned holds auto-release, and holds
never appear as bookings.

Sources of truth: `requirements.md` §5.2/§6.2 (BR-11/17/18, D3/D5) +
`sprint-3-booking-stories.md` BOOK-2 (rules, events, edge cases, acceptance
criteria). No over-engineering; no changes beyond the approved list in §3.

## 1. Scope / non-goals

- **In:** hold entity, create + extend + expiry-release, `slot.held` /
  `hold.expired` outbox events, availability shows holds as TAKEN, unit +
  concurrent tests.
- **Out (do not touch):** BOOK-3 cards, BOOK-4 pay/confirm (only consumes
  `holdId` later), BOOK-8 full jobs (only the minimal release cron here),
  auth middleware/guard logic, seeder schedule-shape mismatch (flagged, not
  fixed), notifications screen.

## 2. New module `src/modules/booking/` (option a)

| File | Content |
|---|---|
| `entities/slot-hold.entity.ts` | Table `slot_holds`: `id, doctorId, clinicId, patientId, date, startTime, endTime, frozenFee decimal(10,2), status ACTIVE/EXPIRED/CONSUMED, expiresAt timestamptz, extendedOnce bool, createdAt`. **Partial unique index `(doctorId, clinicId, date, startTime) WHERE status='ACTIVE'`** = the concurrency guarantee (DB-enforced, not check-then-insert). |
| `dto/create-hold.dto.ts` | `doctorId, clinicId, date (YYYY-MM-DD), startTime (HH:mm)` — class-validator only; no price/fee accepted from the client. |
| `use-case/create-hold.use-case.ts` | Same checks as BOOK-1 availability (pairing active, verified doctor, date not past, ≤60d window, slot aligns with schedule, Cairo `Africa/Cairo` now): one QueryRunner tx → insert hold (`expiresAt = now + 10min`) + outbox `slot.held` → commit → `setImmediate(triggerPublish)`. Catch `23505` → `409 BOOKING_SLOT_UNAVAILABLE`. |
| `use-case/extend-hold.use-case.ts` | Owner + ACTIVE + unexpired only; if `extendedOnce` → `409 BOOKING_HOLD_EXTENSION_ALREADY_USED`; else `expiresAt += 5min`, `extendedOnce = true`. |
| `use-case/release-expired-holds.use-case.ts` | `@Cron(EVERY_MINUTE)`: `UPDATE ... SET EXPIRED WHERE ACTIVE AND expiresAt < now()` (limit 50) + one outbox `hold.expired` per hold. Idempotent — re-runs match zero rows. |
| `booking.service.ts / booking.controller.ts / booking.module.ts` | Facade + `POST /api/v1/booking/holds` and `POST /api/v1/booking/holds/:id/extend`, both `@UseGuards(RolesGuard) @Roles(PATIENT)`. Guest → `AUTH_REQUIRED`, unverified → `PHONE_VERIFICATION_REQUIRED` via the existing guard; no custom auth code. |
| `*.spec.ts` (colocated) | Mock pattern copied from `signup.use-case.spec.ts` (`getRepositoryToken`, mocked `DataSource.createQueryRunner`, assert `triggerPublish` after a tick). One **concurrent test** against real Postgres (docker compose): two parallel `execute()` calls assert exactly one success + one `409` — mocked repos cannot prove this. |

## 3. Permitted edits to existing code (approved)

1. `src/app.module.ts` — add the `BookingModule` import. One line.
2. `src/modules/catalog/use-case/get-doctor-availability.use-case.ts` — add
   an active-holds query; union with booked times into the TAKEN set. No
   other logic change.
3. Nothing else. No middleware, guard, envelope, seeder, or
   appointment-entity changes.

## 4. Contracts

- Success envelope via the existing interceptor; errors via the shared
  filter with i18n-style codes (D13): `BOOKING_SLOT_UNAVAILABLE (409)`,
  `BOOKING_HOLD_EXPIRED (409/410)`,
  `BOOKING_HOLD_EXTENSION_ALREADY_USED (409)`,
  `BOOKING_HOLD_NOT_FOUND (404, including cross-user reads per
  requirements §3)`. Never English sentences in contracts.
- Events on the existing `auth_exchange` via the transactional outbox
  (same pattern as `SignupUseCase`): `slot.held {holdId, patientId,
  doctorId, clinicId, date, startTime, frozenFee, expiresAt}`,
  `hold.expired {holdId, ...slot key}`.
- Money: `decimal(10,2)` end to end; `frozenFee` copied from
  `DoctorClinic.consultationFee` at hold time (BR-17). Never float.

## 5. Edge-case dispositions

- Re-hold after abandon allowed (partial index blocks ACTIVE only).
- Same user holding two different slots allowed (no per-user uniqueness).
- Schedule deleted mid-hold → hold row survives; availability recompute
  does not delete holds.
- Release job down for an hour → cron catches up on restart; affected
  users get a recoverable `409/410` and re-pick.
- Holds never appear in history (no booking row is written by BOOK-2).

## 6. Verification

- `npx jest src/modules/booking` — all green, including the concurrent
  exactly-one-winner test.
- `npm run lint` on touched files.
- Definition of Done: every rule enforced server-side, every acceptance
  criterion tested (including negative + concurrent), every edge case with
  defined behaviour, events via outbox with consumers outside the
  publisher, idempotent job, no secrets logged, shared envelope + codes.
