# AGENTS.md — DOCURA Backend

NestJS 10 + TypeScript + TypeORM + PostgreSQL 16 + RabbitMQ + Redis 7. Source of business truth: `requirements.md` (BR/D rules, edge cases) + Figma. Derive schema/endpoints/events from those — never invent.

## Dev loop (use Docker)

Canonical run: `docker compose up --build` (api + postgres + redis + rabbitmq + pgadmin + seeder, hot-reload via volume mount). Fresh DB: `docker compose down -v`.
Inside Compose, hosts are service names (`postgres`, `redis`, `rabbitmq`); outside Docker use `localhost`. Copy `.env.example` to `.env` — app fails fast via `src/config/validation.schema.ts` (Joi; only `DB_*` strictly required, rest have defaults/fallbacks — set real `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, middleware falls back to `access_secret_key`).

- `npm run start:dev` (local, no Docker) · `npm run build` + `npm run start:prod` (`node dist/main`)
- `npm run lint` (eslint `--fix`) · `npm run format` (prettier `src/**/*.ts`)
- `npm test` — jest with `rootDir: src`, colocated `*.spec.ts`; single test: `npx jest src/modules/auth/use-case/signup.use-case.spec.ts`; `npm run test:cov` for coverage. `test:e2e` script exists but no `test/` dir — don't run it.
- `npm run seed` — `CatalogSeeder`: idempotent 8 specialties + 4 clinics + 50 doctors with `DoctorClinic` pairings; evicts Redis `catalog:home:public_data`. Also runs as Compose `seeder` service.

## Architecture: follow the existing slice

`src/main.ts`: global prefix `api/v1` + global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `TransformInterceptor` + `GlobalExceptionFilter`.

- Layers: Controller (HTTP only) → Service (facade) → `use-case/` (one file per operation, e.g. `signup.use-case.ts`) → TypeORM repository. New modules go in `src/modules/<name>/` with `entities/`, `dto/` (class-validator on every endpoint), `use-case/`, `consumers/`. See `auth/`, `catalog/`, `notification/`, `search/`.
- Shared: `src/common/{filters,interceptors,middleware,guards,decorators,outbox,redis,mail,utils,constants}`; config in `src/config/`; DB bootstrap in `src/database/database.module.ts`. `AuthModule` and `RedisModule` are `@Global()`.
- Envelopes are fixed — don't reshape: success via interceptor `{success:true, statusCode, message, data}` (it unwraps a returned `message` field); errors via filter `{success:false, statusCode, errorCode, message, timestamp, path}`. Use i18n-style codes (`code`/`messageKey`, e.g. `errors.auth.*`), never English sentences in contracts (D13: Arabic later).
- `DB_SYNC=true` only for local dev; production must be `false` (migrations — none exist yet).

## AuthZ: deny-by-default — you will lock or leak endpoints if you miss this

- `AuthContextMiddleware` (on `*`) builds `req.userContext`: Bearer JWT → `{role: payload.status, userId, familyId}`; else `x-device-id` header → `{role:'GUEST'}`; else 401. Public paths are hardcoded in the middleware (`signup, verify-email, resend-otp, signin, refresh`) — a new public endpoint needs an entry there AND `@Roles`.
- `RolesGuard` denies by default: no `@Roles()` → `AUTH_DENIED_BY_DEFAULT` 403. Every route needs `@UseGuards(RolesGuard)` + `@Roles(...UserStatus)`. Roles = `GUEST | UNVERIFIED_PATIENT | PATIENT | DOCTOR | ADMIN` (`UserStatus` enum). Guests send `x-device-id`, no token. `PATIENT`-only gates booking; `UNVERIFIED_PATIENT` gets `PHONE_VERIFICATION_REQUIRED`, `GUEST` gets `AUTH_REQUIRED`.
- Ownership: another user's record → **404, not 403** (requirements §3). Check use-cases before exposing cross-user reads.

## Events: transactional outbox is mandatory, not optional

Pattern (see `SignupUseCase` + `OutboxProcessorService` + `auth-rabbitmq.consumer.ts`):

1. In one `QueryRunner` transaction save business row + `OutboxEventEntity{aggregateType, eventType (past tense, e.g. `user.registered`, `doctor.favorited`, `guest.promoted`), payload (consumer-complete, no secrets), isProcessed:false}`; commit; then `setImmediate(() => triggerPublish(eventId))`.
2. `OutboxProcessorService` publishes to `auth_exchange` (topic) with `x-event-id` header, marks processed; `@Cron(EVERY_MINUTE)` retries oldest 10 unprocessed. Only exchanges wired in `app.module.ts`: `auth_exchange`, `auth_exchange.dlx` — reuse them.
3. Consumers (`@RabbitSubscribe`): declare DLQ via `queueOptions.arguments x-dead-letter-exchange/routing-key`; first do idempotency guard `ProcessedEventEntity.insert({eventId})` → on conflict log + return (skip); never let a consumer throw back into the producer — catch, log, `return new Nack(false)` to DLQ.

## Domain gotchas already encoded — don't regress

- Fee/schedule live on `DoctorClinicEntity` (per doctor+clinic pair, `decimal(10,2)`, `unique(doctorId,clinicId)`), never on doctor alone (BR-10). Money: never float.
- Identity: `normalizeEgyptianPhoneNumber` (`0…` → `+20…`), email `lowercase().trim()`; re-signup of unverified user reuses the row and resets OTP (see `signup.use-case.ts`).
- Never log passwords, OTPs, tokens, card data, full phone numbers. `maskEmail`/`maskPhoneNumber` exist in `common/utils/`.
- Tests colocate as `*.spec.ts` mocking `getRepositoryToken`, `DataSource.createQueryRunner`, `OutboxProcessorService.triggerPublish` (copy `signup.use-case.spec.ts`). `setImmediate` publish means awaiting a tick (`await new Promise(r => setImmediate(r))`) before asserting publish.
