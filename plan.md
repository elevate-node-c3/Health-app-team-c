# AUTH-6 — Guest becomes registered user

## Summary
Guest promotion happens at signup (booking entry point). Guest provides `X-Device-Id` header and signs up with full `UserEntity` fields; system creates unverified user, publishes `guest.promoted` via outbox + RabbitMQ, migrates guest searches asynchronously without blocking registration, and echoes booking intent for resume.

## Changes
**New**
- `user-search.entity.ts` — `user_searches` (`user_id`, `search_query`, `unique`)
- `guest-promotion.entity.ts` — `guest_promotions` (`device_id unique`, `user_id`, `booking_intent jsonb`)
- `booking-intent.dto.ts` — `doctorId, clinicId, date, time` (all optional)
- `promote-guest.use-case.ts` — merge dedup (normalize), `GUEST_ALREADY_CLAIMED`, `23505` race, idempotent
- `guest-promotion.consumer.ts` — `guest.promoted` log-only consumer

**Modified**
- `sign-up.dto.ts` — `fullName, email, phoneNumber, gender, password, confirmPassword` (covers `UserEntity` columns) + optional `bookingIntent`
- `auth.controller.ts` — `POST /signup` reads `X-Device-Id`
- `auth.service.ts` / `signup.use-case.ts` — `execute(dto, guestDeviceId)` creates `guest.promoted` event transactionally, `setImmediate(triggerPublish)`, returns `pendingBookingIntent`
- `sign-in.use-case.ts` — also promotes on `POST /signin` with `guestDeviceId` (merge, dedup) for existing user on guest device
- `auth.module.ts` — registers new entities/providers

**Deferred**
- No booking module — promotion via signup as clarified; no AI conversation tables yet

## Behavior
- Missing device → no event, 201 still
- Already claimed → skip, no leak
- Double delivery → no duplicates
- Failure → logged, never blocks signup/signin
