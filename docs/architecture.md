# DOCURA Backend — Architecture

This document describes the runtime architecture, request lifecycle, and event-driven design of the DOCURA backend (`src/`).

## 1. Overview

DOCURA is a modular NestJS 10 + TypeScript API backed by PostgreSQL (TypeORM), Redis, and RabbitMQ. It follows vertical slices (one folder per business capability) with a shared infrastructure layer.

```
Client (mobile app)
  │
  ▼
NestJS API (`api/v1`) ──► PostgreSQL (source of truth)
  │                          ▲
  │──► Redis (cache / counters / rate limits)
  │
  └──► RabbitMQ (domain events) ──► Consumers (notifications, reminders, audit)
```

Services:

| Service | Purpose | Compose name |
|---|---|---|
| `api` | NestJS backend, hot-reload in dev | `nestjs_api` |
| `postgres` | Primary store, unique constraints enforce correctness | `nestjs_postgres` |
| `redis` | Caching, OTP / rate-limit counters | `nestjs_redis` |
| `rabbitmq` | Event transport + DLX per exchange | `nestjs_rabbitmq` |
| `seeder` | One-shot seed job (`npm run seed`) | `nestjs_seeder` |
| `pgadmin` | DB inspection UI on `:5050` | `nestjs_pgadmin` |

Full service definition: `docker-compose.yml`. Entry point: `src/main.ts` → `src/app.module.ts`.

## 2. Module Layout

Vertical slices in `src/modules/`:

| Module | Responsibility |
|---|---|
| `auth` | Registration, OTP verification, login, sessions, guests, social sign-in |
| `catalog` | Specialties, doctors, clinics, doctor↔clinic pairing (fee + schedule), reviews, favorites, articles |
| `search` | Unified search (specialty vs. doctor), filters, sort, map/geo |
| `booking` | Slot holds, appointments, cancellation / reschedule policy, slot release |
| `payment` | Saved cards (last4 only), charges, refunds, Stripe webhooks, idempotency |
| `notification` | Push / SMS / email consumers, inbox, reminders |
| `prescription` | Prescription files, signed download links |
| `ai-assistant` | Read-only AI tools over catalog + own appointments, limits and spend guardrails |
| `analytics` | Counters fed by domain events |

Shared infrastructure in `src/common/` (`guards/`, `filters/`, `interceptors/`, `middleware/`, `outbox/`, `redis/`, `utils/`, `mail/`), configuration in `src/config/`, seeds in `src/database/seeds/`.

Per-slice structure:

```
module/
├── *.controller.ts   # HTTP only: DTO validation, auth context extraction
├── use-case/         # Business rules (e.g. SignupUseCase, CancelUseCase)
├── *.service.ts      # Orchestration / persistence
├── entities/         # TypeORM entities, DB constraints
├── dto/              # class-validator DTOs
└── consumers/        # RabbitMQ subscribers (idempotent, non-throwing)
```

Rule: controllers never contain business rules; use-cases never touch HTTP. Price, availability, status, fees, and refund eligibility are always decided server-side.

## 3. Request Lifecycle

Every request passes through the same pipeline (wired in `src/main.ts` and `src/app.module.ts`):

```
1. AuthContextMiddleware  → builds user context (Bearer JWT or x-device-id for guests)
2. RolesGuard             → @Roles(...) required on every route; denies by default (403)
3. ValidationPipe         → global, whitelist + forbidNonWhitelisted + transform; DTOs on every endpoint
4. Controller → Use-Case → Service → TypeORM entity
5. TransformInterceptor   → success envelope { success, statusCode, message, data }
6. GlobalExceptionFilter  → error envelope { success, statusCode, errorCode, message }; stable
                           machine codes + messageKey 'errors.…'; never leaks stack/SQL/provider text
```

Key domain facts enforced in this pipeline:

- Global prefix is `api/v1`.
- Fee and schedule live on the **doctor↔clinic pairing**, not on the doctor.
- Money is `decimal(10,2)` in EGP, never float. Cards store only last4/brand/expiry.
- Ownership: appointments, cards, notifications, favorites, conversations are scoped to one user. Cross-user access returns **404, not 403**.
- Guests browse/search but cannot book, favorite, or receive notifications.

## 4. Event-Driven Design

### 4.1 Transactional outbox

Dual-write is avoided with the transactional outbox pattern (`src/common/outbox/`):

```
Use-Case transaction: [ business row + outbox_events row ] (single COMMIT)
        │
        ▼
OutboxProcessorService (cron, EVERY_MINUTE + immediate triggerPublish)
        │  claims rows with FOR UPDATE SKIP LOCKED, publishes to exchange
        ▼
RabbitMQ exchange (*_exchange) ──► consumer queue(s)
                                       │ failure → nack, no requeue
                                       ▼
                                   *.dlx dead-letter exchange for inspection
```

Behavior: `MAX_RETRY_ATTEMPTS = 10`, then `FAILED_PERMANENTLY` + alert via `AlertService`. The producer never depends on consumer success.

### 4.2 Exchanges

Declared in `src/app.module.ts` (topic, each with a `.dlx` pair):

- `auth_exchange` — registration, OTP, login, lockout events
- `appointment_exchange` — holds, bookings, cancellations, reschedules, `PRESCRIPTION_ISSUED`
- `payment_exchange` — charges, refunds, webhook outcomes
- `ai_exchange` — assistant usage / cost events

Live catalogue: `docs/event-catalogue.md`.

### 4.3 Consumer contract

- Past-tense names (`appointment.booked`), payload carries what consumers need without querying back.
- Idempotent via `ProcessedEventEntity` check-then-insert; duplicate delivery yields a single outcome.
- Non-throwing: a failing consumer (SMS down) never rolls back the booking; messages are retried then DLQ-routed, never silently dropped.
- Stripe webhooks verified by signature; payments/refunds keyed by `idempotencyKey` (`REFUND-<appointmentId>`).

## 5. Concurrency and Money

- One active appointment per slot is enforced by a **DB unique constraint**; concurrent inserts surface Postgres `23505`, mapped to `409 Conflict` — never a read-then-insert check.
- Availability is re-checked at payment time, not just when the slot list loaded.
- Slot hold: **10 min + one 5-min 3DS extension**. Abandoned holds are released by scheduled use-cases (fake clocks in tests, no sleeps).
- Cancellation boundary **≥24h = free** (`src/modules/booking/policies/cancellation-policy.ts`); the decision is computed server-side at confirmation time (`preview` ≠ decision). Reschedule: once, same 24h rule. Cancel always frees the slot.
- Failed payment creates no appointment and leaves the slot free. Refunds track their own lifecycle (`refund-pending`, 5–10 business days).

## 6. AuthN, AuthZ, and Abuse Protection

- Roles: `GUEST | UNVERIFIED_PATIENT | PATIENT | DOCTOR | ADMIN`. `/auth/*` and `/payments/webhook` are the only public paths.
- OTP: 4-digit, 3-min, single-use, purpose-bound; 5 wrong attempts kills the code. Resend after 60s, ≤3/code, ≤5/hour. 10 failed sign-ins → 15-min lock. Counters live in DB/Redis so they survive restarts.
- Refresh tokens stored SHA-256 hashed; multi-device sessions via a dedicated entity. Secrets and API keys are backend-only; no passwords, OTPs, tokens, card data, or full phones in logs (`maskPhoneNumber()`).
- AI tools are read-only, check caller identity server-side, and enforce 50 msgs/day (user) / 10 msgs/day/device (guest) plus a monthly spend ceiling.

## 7. Configuration and Environments

- `src/config/validation.schema.ts` (Joi) fail-fasts on missing vars. Copy `.env.example` → `.env`.
- In compose, in-network hosts are service names: `DB_HOST=postgres`, `REDIS_HOST=redis`, `RABBITMQ_URL=amqp://…@rabbitmq:…`.
- Local JWT values in examples are placeholders; never commit real secrets.
