# CAT-5 (Filters) & CAT-7 (Favourites) — Implementation Notes

## CAT-7 — Favourite a doctor

### Behaviour
- Signed-in only. Guests are blocked by `RolesGuard` (no `GUEST` role on the routes) with `403 AUTH_REQUIRED`, so there is nothing to migrate on signup.
- `POST /catalog/favorites/:doctorId` — only verified doctors can be favourited (`findOne({ id, isVerified: true })`, else `404`). Re-favouriting returns success with `Doctor already in favorites` and publishes no second event. A `23505` race on concurrent requests is treated as success.
- `DELETE /catalog/favorites/:doctorId` — deleting a non-favorite is a no-op success (`{ isFavorite: false }`), never an error.
- `GET /catalog/favorites` — owned-only (`where: { userId }`, newest first). A favourited doctor that is later deactivated is kept as a stub (`{ doctorId, isFavorite: true, isDeactivated: true }`) so the user can still unfavourite it. Verified doctors return the standard card shape with the `MIN(fee)` price rule.
- Favourites are the single source of truth for the heart state on Home (merged per request, never cached).

### Events
- `doctor.favorited` / `doctor.unfavorited` via the outbox pattern: business row + `OutboxEventEntity` in one `queryRunner` transaction, then `setImmediate(() => triggerPublish(eventId))`. Unfavouriting a non-favorite publishes nothing.
- The notification (`Dr. <name> has been added to favorite`) is written only by `FavoriteNotificationConsumer` (`favorite_notifications_queue`), which never throws: duplicates are skipped via `ProcessedEventEntity` on `x-event-id`, writer failures are logged. The favourite code has zero notification imports. `doctor.unfavorited` is analytics-only with no consumer.

### Files
- `use-case/add-favorite.use-case.ts`, `use-case/remove-favorite.use-case.ts`, `use-case/list-favorites.use-case.ts`
- `consumers/favorite-notification.consumer.ts` (notification module)
- Specs: `add-favorite.use-case.spec.ts`, `remove-favorite.use-case.spec.ts`, `list-favorites.use-case.spec.ts`, `favorite-notification.consumer.spec.ts`

## CAT-5 — Filters

### Surface (no route)
CAT-5 ships a reusable filter block that the CAT-4 listing endpoint imports. No controller route was added:
- `dto/filter-doctors.dto.ts` — validated filter input (all fields optional).
- `utils/create-base-doctor-query.ts` — `createBaseDoctorQuery(repo)` owns the scoped base query (verified doctors + active pairings + joins + card select + `GROUP BY`). The use-case and the CAT-4 listing both build from it.
- `utils/apply-doctor-filters.ts` — pure `applyDoctorFilters(qb, filters, now?)` that ANDs conditions onto the base query.
- `use-case/list-filtered-doctors.use-case.ts` — service-level listing (`CatalogService.listFilteredDoctors`), wired in `catalog.module.ts` providers only.

### Filter semantics
- Base scope (from the factory): `doctor.isVerified = true` + inner join on active `doctor_clinics`, so inactive pairings never appear.
- Empty group means no constraint. `genders: [Male, Female]` together is the same as no gender filter. Multi-value arrays are capped (`ArrayMaxSize`) against hand-crafted expensive requests.
- `rating` is "and above" (`averageRating >= :rating`, single value 1–5).
- Price filters apply to the displayed card price, `MIN(dc.consultationFee)` via `HAVING`: `minPrice > maxPrice` is rejected naming the field; `maxPrice = 1000` means 1000 and above (no upper bound); a lone bound filters one-sided.
- `governorate` / `city` / `places` / `titles` / `specialtyId` are equality/`IN` filters on the joined clinic/doctor rows. `city` + `governorate` that match no seeded clinic pair is rejected with an error naming `city`.
- Availability (`Today` / `Tomorrow`) is judged in `Africa/Cairo` against `doctor_clinics.schedule.days` (seed tokens `Sun..Sat`): a doctor must have at least one active pairing whose working days include the Cairo today/tomorrow token. Fully-booked-slot exclusion needs the Sprint-3 bookings table and is intentionally not implemented.
- Invalid input (unknown enum, rating 9, negative price, bad UUID) is rejected by DTO validation with field-level errors.
- Sort is an explicit passthrough (`recommended` = rating DESC, `priceAsc`, `priceDesc`) with a `doctor.id ASC` tiebreak for stable paging. Paging is offset/limit, `limit` capped at 50. `total` is a `COUNT(*)` over the same filtered query (same `WHERE`/`HAVING`), so no rows are fetched to count. Empty results return `{ data: [], total: 0 }`, never an error.

### Model addition
- `DoctorGender` (`Male` / `Female`), nullable indexed `doctor.gender` column (additive, existing rows unaffected). `catalog.seed.ts` assigns a random gender on create and backfills nulls on re-run.

### Events
- `catalog.filters_applied` (`CATALOG` aggregate) persisted to the outbox and published fire-and-forget via `setImmediate`; a persist failure is logged and never breaks the response.

### Tests
- `filter-doctors.dto.spec.ts` — empty OK, comma-string transform, rejects unknown gender/place, rating 9, negative price, bad UUID.
- `apply-doctor-filters.spec.ts` — no-op on empty, both-genders no-op, `>=` rating, `min > max` rejection, max-1000 inclusivity, Cairo Today/Tomorrow tokens incl. near-midnight boundary.
- `list-filtered-doctors.use-case.spec.ts` — city/governorate rejection, stable tiebreak, price ordering, well-formed empty page.

### Explicitly out of scope
No listing route or "Most Recommended" definition (CAT-4), no slots/bookings tables (Sprint 3), no geo index or map view (CAT-6).
