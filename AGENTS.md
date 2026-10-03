# AGENTS.md — DOCURA Backend

## Project overview
- DOCURA doctor-appointment API: NestJS 10 + TypeScript + PostgreSQL (TypeORM) + RabbitMQ (`@golevelup/nestjs-rabbitmq`) + Redis + `@nestjs/schedule`. See `package.json`, `src/app.module.ts`, `docker-compose.yml`.
- Entrypoints: `src/main.ts` (global prefix `api/v1`, global `ValidationPipe`, `TransformInterceptor`, `GlobalExceptionFilter`) → `src/app.module.ts`.
- Vertical slices in `src/modules/`: `auth` · `catalog` · `search` · `booking` · `payment` · `notification` (+ `analytics`). Shared infra in `src/common/` (`filters/`, `guards/`, `interceptors/`, `middleware/`, `outbox/`, `redis/`, `utils/`), config in `src/config/`, seeds in `src/database/seeds/`.
- Key domain facts (`requirements.md`): fee/schedule live on the **doctor↔clinic pairing** (`doctor-clinic.entity.ts`), not the doctor; money in EGP; cancellation boundary **≥24h = free** (`src/modules/booking/policies/cancellation-policy.ts`); slot hold **10 min + one 5-min 3DS extension**; reschedule **once, same 24h rule as cancel**; guests browse/search but cannot book, favorite, or get notifications.
- Events: transactional outbox (`common/outbox/` → `OutboxProcessorService` cron → `*_exchange` + `.dlx` exchanges) → RabbitMQ consumers. Consumers are non-throwing, DLQ-routed, and idempotent via `ProcessedEventEntity` checks.

## Build and test commands
- Preferred local run: `docker compose up --build` (API + Postgres + Redis + RabbitMQ + pgAdmin, hot-reload). Fresh start: `docker compose down -v`. Local (no Docker): `npm install`, then `npm run start:dev`.
- Other: `npm run build` (`nest build`), `npm run start:prod` (`node dist/main`), `npm run lint`, `npm run seed` (`src/database/seeds/run-seed.ts`, also runs as `seeder` service in compose).
- Jest unit: `npm test` (rootDir `src`, `*.spec.ts`), single file: `npx jest src/modules/booking/policies/cancellation-policy.spec.ts`. E2E: `npm run test:e2e` (`test/jest-e2e.json`). Coverage: `npm run test:cov`.
- DB-backed concurrency proof (`create-hold.concurrent.spec.ts`) is **skipped unless `DB_HOST`/`DB_NAME` is set** and expects Postgres unique-violation `23505` (exactly one of two parallel holds wins). Run it against real Postgres, never mock it.
- Env: copy `.env.example` → `.env`. App fail-fasts on missing vars via `src/config/validation.schema.ts` (Joi); in compose, `DB_HOST=postgres`, `REDIS_HOST=redis`, `RABBITMQ_URL=amqp://…@rabbitmq:…`. Local JWT secrets in README are placeholders — never commit real ones.

## Code style guidelines
- Structure per slice: `*.controller.ts` (HTTP only) → `use-case/*.use-case.ts` (business rules) → `*.service.ts` / entities (TypeORM). Follow existing slices; don't add Express-style handlers inside Nest code.
- DTO on every endpoint with `class-validator`; global pipe is `whitelist: true, forbidNonWhitelisted: true, transform: true` — unknown fields are rejected, so never trust client-sent price/status/fees.
- Responses: success envelope via `TransformInterceptor` (`{success:true,statusCode,message,data}`); errors via `GlobalExceptionFilter` (`{success:false,statusCode,errorCode,message,…}`). Throw `HttpException`s with stable machine codes + `messageKey: 'errors.…'` (i18n-ready, Arabic later) — e.g. `AUTH_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, `AUTH_DENIED_BY_DEFAULT`. Never leak stack/SQL/provider text.
- AuthZ: every route needs `@Roles(...)` (`common/decorators/roles.decorator.ts`). `RolesGuard` **denies by default** (no metadata → 403); roles are `GUEST | UNVERIFIED_PATIENT | PATIENT | DOCTOR | ADMIN` from `AuthContextMiddleware` (Bearer JWT or `x-device-id` for guests; `/auth/*` + `/payments/webhook` are the only public paths).
- Money: `decimal(10,2)` columns, never float. Cards: store only `last4Digits`/brand/expiry — never PAN/CVV. Payments/refunds keyed by `idempotencyKey` (`REFUND-<appointmentId>` pattern).
- `noImplicitAny: false` in `tsconfig.json`, but requirements demand strict domain code — avoid `any` in `modules/`.

## Testing instructions
- Colocate unit tests as `<name>.spec.ts` next to the use-case/policy (see `booking/use-case/*.spec.ts`, `payment/use-case/*.spec.ts`). Pure rules first: `decideCancellation()` (>, <, exactly 24h, already-started), phone normalize (`010…` → `+20…`), password/OTP limits, `1000 EGP` filter = "1000 and above".
- Required coverage per `requirements.md §11`: cancellation policy, availability (taken/past slots excluded, today/tomorrow excludes fully-booked), booking (failed payment → no appointment; double-submit charges once; taken slot → `409 Conflict`), authZ (guest can't book; user A can't read user B), consumers (duplicate delivery → single outcome; consumer failure never undoes the booking).
- Flows needing integration tests: **book → pay → confirm** and **cancel → refund decision → slot released**. Slot-release/hold-expiry runs via scheduled use-cases — test with fakes/clocks, not sleeps.
- `npm test` runs without infra except the gated concurrency spec above. Don't add suites requiring RabbitMQ/Stripe/real SMS without a skip guard.

## Security considerations
- Ownership: every appointment/card/notification/favorite/conversation belongs to one user — return **404, not 403**, on cross-user access so IDs aren't enumerable. Enforce in the use-case (scoped query), not just the guard.
- Secrets: refresh tokens stored hashed (SHA-256); never log passwords, OTPs, tokens, card data, or full phones — use `maskPhoneNumber()`. API keys (Stripe/AI) backend-only, never to the client.
- AuthN abuse: OTP 4-digit / 3-min / single-use / purpose-bound; 5 wrong attempts kills code; resend after 60s, ≤3/code, ≤5/hour; 10 failed sign-ins → 15-min lock. Counters must survive restarts (DB/Redis, not memory).
- Money/concurrency: re-check availability at payment time; single active appointment per slot enforced by a **DB unique constraint** (catch `23505` → `409`), not a pre-insert check. Cancel/reschedule decision computed **server-side at confirmation time** (`preview` ≠ decision) so a dialog opened at 24h05m confirmed at 23h58m charges correctly.
- Consumers/webhooks: idempotent (check-then-insert `ProcessedEventEntity`, Stripe `idempotencyKey`), retry-then-DLQ, never throw back into the producer. Verify Stripe webhooks by signature; treat AI-assistant tools as read-only with caller-identity checks server-side.
