# Design decisions

Where the §7.2 questions and §9 rulings live in the code. Every pointer was
read from source; gaps are flagged as gaps, not described as done.

## §7.2 answers

1. **Fee lives on the pairing.** `DoctorClinicEntity.consultationFee`
   (`src/modules/catalog/entities/doctor-clinic.entity.ts`), frozen onto the
   hold (`SlotHoldEntity.frozenFee`) at hold time and snapshotted onto the
   appointment, so later fee edits never rewrite history.
2. **Slots are computed, not stored.** `CreateHoldUseCase` builds valid slots
   from the pairing `schedule` (`generateSlots` in
   `src/modules/booking/use-case/create-hold.use-case.ts`) and validates
   alignment, window (60 days) and past-today on every request. Cost: each
   availability read walks schedules instead of scanning rows; benefit: schedule
   edits apply instantly with no slot-row migration.
3. **One active appointment per slot is a DB guarantee.** Partial unique index
   on `(doctorId, clinicId, date, startTime)` where status is BOOKED
   (`appointment.entity.ts:28-31`); simultaneous inserts race in Postgres and
   exactly one wins. Losers catch `23505` → `409 BOOKING_SLOT_UNAVAILABLE`
   (`create-hold.use-case.ts:238-249`, same pattern in prescription attach).
4. **Holds are first-class rows.** `SlotHoldEntity` with 10-minute `expiresAt`
   (`HOLD_TTL_MINUTES`), one 5-minute 3DS extension
   (`extend-hold.use-case.ts:42-47`, once-only flag). Abandoned holds are
   reclaimed by the `ReleaseExpiredHoldsUseCase` cron emitting `HOLD_EXPIRED`;
   an expired hold returns `400 Hold expired` at pay time.
5. **Money is `decimal(10,2)` in EGP, never float.** Amounts, fees and refunds
   use `decimal` columns; Stripe is charged with `Number(hold.frozenFee)` and
   `egp` currency (`process-payment.use-case.ts:95-100`). Cards store only
   last4/brand/expiry, never PAN/CVV.
6. **Cancelled stays as a row.** `AppointmentEntity.status = CANCELLED` with
   `cancelledAt` + `cancellationOutcome`; the Cancelled tab reads history, rows
   are never deleted. The partial unique index only covers BOOKED, so a
   cancelled slot is bookable again.
7. **A guest is a device id, not a row.** `x-device-id` → `GUEST` context
   (`auth-context.middleware.ts:69-75`); searches ride the device id and are
   migrated to the user on register (`promote-guest.use-case.ts`,
   `guest.promoted` event).
8. **Health data is prescription files + AI content.** Files live outside the
   web root under `PRESCRIPTION_STORAGE_PATH`, served only via HMAC links with
   ownership re-check (`prescription.service.ts:downloadFor`); logs carry ids,
   never content. Purge removes rows transactionally first, then files
   best-effort (`purge-patient-prescriptions.use-case.ts`); AI text is purged
   after 12 months (`purge-ai-retention.use-case.ts`).

## §9 rulings → enforcement

| # | Enforced in |
|---|---|
| D1 24h boundary favors patient | `cancellation-policy.ts` (`>=` 24h free); boundary spec at exactly 24h (`cancellation-policy.spec.ts`) |
| D2 reschedule = same 24h rule, once | `reschedule-appointment.use-case.ts` (original timing governs, `rescheduleCount` capped, in-window refused); spec |
| D3 phone demanded at booking, not signup | `roles.guard.ts:43-48` (`UNVERIFIED_PATIENT` → `PHONE_VERIFICATION_REQUIRED`); signup stays one-tap |
| D4 OTP/sign-in abuse counters | PARTIAL GAP. `failedAttemptsCount` 5-kill + 3-min code expiry live on `UserEntity` columns (DB-backed, survive restart: `verify-email.use-case.ts:37-52`). Resend gap (60s), resend caps (3/code, 5/hour) and 15-min sign-in lockout are **not enforced in code** — no throttle state found. Open item in `go-live-report`. |
| D5 10-min hold + one 5-min 3DS extension | `create-hold.use-case.ts:20` (`HOLD_TTL_MINUTES`), `extend-hold.use-case.ts:42-47`, `release-expired-holds.use-case.ts` cron |
| D6 clock completes appointments | `complete-appointments.use-case.ts` every-minute cron → COMPLETED/NO_SHOW + outbox in one txn |
| D7 refund-pending + arrival estimate | `RefundEntity` lifecycle PENDING → ISSUED → SETTLED (`refund.service.ts`); `expectedArrivalAt` = 10 business days (`BUSINESS_DAYS_TO_ARRIVE`) |
| D8 no-show is final, distinct, no refund | `completion-policy.ts` (grace window → NO_SHOW), `complete-appointments.use-case.ts:57-63` separate statuses |
| D9 guest capability matrix | `roles.guard.ts:13-18` deny-by-default (no `@Roles` → 403); guests get `AUTH_REQUIRED`, never silent access |
| D10 12-month AI retention, user-deletable | `purge-ai-retention.use-case.ts` + `ai-retention.cron.ts`; `delete-ai-conversation.use-case.ts` removes content |
| D11 AI spend ceiling | `ai-quota.service.ts` (50/day user, 10/day/device guest, $500 monthly ceiling with 60/80/100% alerts); `ai-rate-limit.guard.ts:50` |
| D12 `1000` means 1000-and-above | `apply-doctor-filters.ts:84` (`maxPrice >= 1000` drops the upper bound); spec pins it |
| D13 language-ready API | `http-exception.filter.ts` + `transform.interceptor.ts` (`code` + `messageKey` contract); AI answers in the user's language |

## Five most dangerous edges

1. **Two users pay for the same slot at once.** DB partial unique index decides,
   loser gets `409` (`appointment.entity.ts:28-31`). Proven by the DB-gated
   concurrency spec against real Postgres, never mocked.
2. **Charged but not booked.** Finalize failures mark the tx
   `REQUIRES_RECONCILIATION` instead of rolling back the charge
   (`process-payment.use-case.ts:140-154`); the reconciliation job heals or
   flags (`payment-reconciliation.service.ts`).
3. **Replayed events.** Money writes key on `PAY-<holdId>-<userId>` and return
   the stored success on retry; consumers claim-first on `ProcessedEventEntity`
   and treat `23505` as already-done, routing poison to DLQ with `Nack(false)`.
4. **Stale 24h decision.** Cancel/reschedule outcomes are computed server-side
   inside the confirmation transaction (`cancel-appointment.use-case.ts`,
   `cancellation-policy.ts`), so a dialog opened at 24h05m and confirmed at
   23h58m charges correctly.
5. **OTP/sign-in brute force (OPEN).** Only the 5-attempt code kill exists;
   resend pacing and sign-in lockout are missing (see D4). Do not go live
   without them or a written risk acceptance.
