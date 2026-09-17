# AGENTS.md — DOCURA Backend (NestJS)

## Run / verify
- Primary dev flow is Docker (hot-reload via volume mount): `docker compose up --build` / `docker compose down` / `docker compose down -v` (wipes PG + Redis + RabbitMQ data).
- Local run outside Docker requires `.env` hosts as `localhost` + infra up: `npm run start:dev` (`npm run build` + `node dist/main` for prod check).
- Seed catalogue: `npm run seed` (`ts-node src/database/seeds/run-seed.ts`). Idempotent (checks before insert); also runs as `seeder` compose service. Needs DB + Redis + RabbitMQ up. Evicts `catalog:home:public_data` when done.
- Tests: `npm test` (jest, `rootDir: src`, only `*.spec.ts`). Single test: `npx jest src/modules/auth/use-case/signup.use-case.spec.ts`. `npm run test:cov` for coverage.
- Broken scripts — do not use: `npm run test:e2e` references `test/jest-e2e.json` (no `test/` dir); `npm run lint` references eslint but repo has no eslint config. Formatter that works: `npm run format` (prettier).

## Env / infra gotchas
- Inside Docker, hosts must be service names (`postgres`, `redis`, `rabbitmq`); locally `localhost`. Compose overrides `DB_HOST=postgres`, `REDIS_HOST=redis`, `RABBITMQ_URL=amqp://…@rabbitmq:…`.
- Env names: code reads `RABBITMQ_URL` (`src/config/rabbitmq.config.ts`) and `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` with insecure fallbacks. README's `JWT_SECRET` / `RABBITMQ_URI` names are stale — trust code + `.env.example`.
- Postgres host port defaults to `5433` (`DB_HOST_PORT`) to avoid local conflicts; container port is `5432`.
- `DB_SYNC=true` in dev only (TypeORM `synchronize`). No migrations exist. Never enable in prod.
- Node 20 (`Dockerfile`, `--legacy-peer-deps` on install).

## Architecture (Controller → Service → Use-Case → Repository)
- Entry: `src/main.ts` — global prefix `api/v1`, global `ValidationPipe { whitelist, forbidNonWhitelisted, transform }`, `TransformInterceptor`, `GlobalExceptionFilter`. Wiring: `src/app.module.ts`.
- Keep business logic in `src/modules/*/use-case/*.ts` with `execute()`; services (`catalog.service.ts`, `auth.service.ts`) only delegate; controllers only handle HTTP. Follow existing use-case as template.
- Response envelope is mandatory: success via `TransformInterceptor` → `{ success:true, statusCode, message, data }` (return `{ message, ...data }` from handler to set message). Errors via `GlobalExceptionFilter` → `{ success:false, statusCode, errorCode, message, timestamp, path }` with `errorCode`/`messageKey` fields.

## Auth (easy to break)
- `AuthContextMiddleware` (`forRoutes('*')`): public paths are only `signup, verify-email, resend-otp, signin, refresh` — `forgot-password / verify-reset-code / reset-password` still require `Bearer` or `x-device-id`. Bearer JWT → role from `payload.status`, `userId` from `sub`; `x-device-id` header alone → `GUEST`. Neither → `AUTH_IDENTITY_MISSING` 401.
- `RolesGuard` denies by default: every handler MUST have `@Roles(...)`; missing decorator → 403 `AUTH_DENIED_BY_DEFAULT`. Guest on signed-in route → `AUTH_REQUIRED`; unverified patient on verified-only route → `PHONE_VERIFICATION_REQUIRED`.
- Extra DTO fields are rejected (400) by `forbidNonWhitelisted` — update DTOs, don't send ad-hoc fields.

## Outbox + RabbitMQ (follow exactly)
- Pattern: save business row + `OutboxEventEntity` in the SAME `queryRunner` transaction, then `setImmediate(() => outboxProcessor.triggerPublish(eventId))`. Cron fallback (`EVERY_MINUTE`, 10 oldest) covers crashes. See `signup.use-case.ts`, `add-favorite.use-case.ts`.
- Publish is to `auth_exchange` with `routingKey = eventType` + header `x-event-id` (`outbox-processor.service.ts`). Second exchange `auth_exchange.dlx` is the DLQ.
- Consumers (`@RabbitSubscribe`) must be idempotent: insert into `ProcessedEventEntity` on `x-event-id` first, skip on conflict. Must be non-throwing: email consumer returns `new Nack(false)` (no requeue, routes to DLQ); favorite consumer catches + logs. Never throw for unbounded retry. See `auth-rabbitmq.consumer.ts`, `favorite-notification.consumer.ts`.
- `OutboxModule` exports only `TypeOrmModule`, not `OutboxProcessorService` — `AuthModule` and `CatalogModule` each re-provide it (duplicate cron runners). Don't add a third provider; fix by exporting from `OutboxModule` if you touch it.
- Favorite → notification separation is intentional: `AddFavoriteUseCase` publishes `doctor.favorited` and must never import notifications; `FavoriteNotificationConsumer` writes the notification.

## Catalog domain invariants (from `sprint-2-catalog-stories.md`)
- Fee + schedule live on the `DoctorClinicEntity` pairing (`(doctorId, clinicId)` unique), never on the doctor. Card/list price = `MIN` active fee (`COALESCE(MIN(dc.consultationFee), 0)` in `get-home-dashboard.use-case.ts`); keep that rule everywhere price is shown/sorted.
- Listings (home/search/map) show only `doctor.isVerified=true` + `doctorClinics.isActive=true`.
- Enums are exact: `PlaceType = clinic | centre | hospital` (note `centre` spelling), `DoctorTitle = Professor | Consultant | Specialist`.
- Ratings: read `averageRating` / `totalReviews` columns; never compute `AVG()` per request.
- Favorites: `user_favorites` unique on `(userId, doctorId)`; add/remove are idempotent (handle `23505` race; unfavorite of non-favorite is success, not 404).

## Home caching
- Redis key `catalog:home:public_data` (TTL 600s) holds only shared parts (categories, topDoctors, articles). Personal parts (favorites, appointments) are merged per request and never cached. Guest response omits `isFavorite` and omits appointment keys entirely (absent, not `null`/`[]`). Greeting uses `Africa/Cairo` timezone.
