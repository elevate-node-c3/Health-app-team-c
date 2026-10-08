# DOCURA Backend API

Short description: DOCURA is a doctor appointment booking backend for patients in Egypt. It lets guests browse doctors, search and filter by specialty, fee, rating, and availability, then — once registered with a verified phone — hold a slot, pay by card, and manage bookings (cancel, reschedule, refunds, prescriptions). Built with NestJS 10 + TypeScript + PostgreSQL (TypeORM) + RabbitMQ + Redis, it is event-driven via a transactional outbox, enforces money and concurrency rules in the database, and never trusts the client for price, availability, or refund decisions.

## Table of Contents

- [Short Description](#docura-backend-api)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Basic Workflow](#basic-workflow)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [API Endpoints Overview](#api-endpoints-overview)
- [Architecture](#architecture)
- [Testing](#testing)
- [Contributing](#contributing)

---

## Key Features

- **Guest-first discovery** — browse, search, filter, view profiles and availability without an account; booking requires a verified phone.
- **Phone verification** — 4-digit OTP, 3-minute expiry, single-use, purpose-bound, with resend and lockout limits.
- **Slot holds** — 10-minute hold while paying, one 5-minute extension for 3-D Secure; abandoned holds auto-release.
- **Concurrency-safe booking** — one active appointment per slot enforced by a DB unique constraint (`23505` → `409 Conflict`).
- **Cancellation policy** — ≥24h = free cancellation + refund; <24h = no refund; reschedule once under the same rule; decided server-side at confirmation time.
- **Payments in EGP** — `decimal(10,2)`, cards stored as last4/brand/expiry only, idempotent charges and refunds.
- **Event-driven side effects** — booking, payment, cancellation, and auth flows publish domain events; notifications, reminders, and counters subscribe independently.
- **Transactional outbox + DLQ** — events committed with the business change, relayed by a cron processor, retried then dead-lettered; consumers are idempotent and non-throwing.
- **Deny-by-default authZ** — every route needs `@Roles(...)`; cross-user reads return 404, not 403.

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | [NestJS](https://nestjs.com/) 10 |
| Language | TypeScript |
| Database | PostgreSQL + TypeORM |
| Messaging | RabbitMQ (`@golevelup/nestjs-rabbitmq`) |
| Cache / counters | Redis (`ioredis`) |
| Scheduling | `@nestjs/schedule` (outbox processor cron) |
| Auth | JWT access + SHA-256 hashed refresh tokens |
| Validation | `class-validator` + global `ValidationPipe` |
| Config | `@nestjs/config` + Joi fail-fast schema |
| Payments | Stripe (signature-verified webhooks, idempotency keys) |
| Containerization | Docker & Docker Compose |

---

## How It Works

1. **Request pipeline** — `AuthContextMiddleware` builds the caller context (Bearer JWT or `x-device-id` for guests) → `RolesGuard` checks `@Roles(...)` (deny by default) → global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) validates the DTO → Controller (HTTP only) → Use-Case (business rules) → Service / TypeORM entity. Responses use the `TransformInterceptor` success envelope; errors go through the `GlobalExceptionFilter` with stable machine codes.
2. **Discovery** — fee and schedule live on the doctor↔clinic pairing, so the same doctor can charge different fees at different clinics. Search resolves both specialties and doctor names; the 1000 EGP price filter means "1000 and above".
3. **Booking** — patient creates a slot hold → pays by card → availability is re-checked at payment time → the appointment is inserted under a DB unique constraint so exactly one of two simultaneous bookers wins. Failed payment creates no appointment and leaves the slot free.
4. **Events** — each state change writes its row plus an `outbox_events` row in one transaction. `OutboxProcessorService` publishes pending rows to the matching `*_exchange`, retrying up to 10 times before marking `FAILED_PERMANENTLY` and alerting. Consumers check `ProcessedEventEntity` first (idempotent), do their own work (email/SMS/push, reminders, counters), and on repeated failure route to the `.dlx` exchange instead of breaking the booking.
5. **Cancel / reschedule** — the server computes free vs. no-refund from the live clock at confirmation time (a preview shown earlier is never the decision). Cancelling always frees the slot; free cancellations create a refund with a `refund-pending` state (5–10 business days).

---

## Basic Workflow

**Patient books a visit:**

```
browse doctors (guest OK) → search / filter / view profile + per-clinic slots
  → sign up + verify phone (OTP) → pick clinic + date + time → hold slot (10 min)
  → pay by card → instant confirmation (in-app + SMS/email/push, "arrive 15 min early")
```

**Patient cancels:**

```
preview cancellation (shows fee consequence) → confirm cancel
  → server decides free (≥24h, refund issued) vs. no-refund (<24h)
  → slot released → reminder cancelled → notification sent
```

**Failure paths:** taken slot → `409 Conflict`; failed payment → failure screen, slot stays free; consumer failure (e.g. SMS down) → booking still stands, event retried then dead-lettered.

---

## Installation

### Prerequisites

- Node.js 20+, npm
- Docker + Docker Compose (recommended: runs API + Postgres + Redis + RabbitMQ + pgAdmin + seeder)

### 1. Clone the repository

```bash
git clone https://github.com/elevate-node-c3/Health-app-team-c.git
cd Health-app-team-c
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in the required variables (app fail-fasts on missing values). Inside the Docker network, hosts are service names:

```env
PORT=3000
API_PREFIX=api/v1

DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=docura
DB_PASSWORD=docura
DB_NAME=docura_db
DB_SYNC=true
DB_LOGGING=false

JWT_ACCESS_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

REDIS_HOST=redis
REDIS_PORT=6379

RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_PORT=5672
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
```

### 3. Run with Docker Compose (recommended)

```bash
docker compose up --build
```

Starts the API (hot-reload), PostgreSQL, Redis, RabbitMQ (management UI on `:15672`), pgAdmin (`:5050`), and a one-shot seeder. Stop with `docker compose down`; wipe all data with `docker compose down -v`.

### 4. Or run locally (no Docker)

```bash
npm install
npm run start:dev
```

Point `DB_HOST`, `REDIS_HOST`, and `RABBITMQ_URL` at your local Postgres / Redis / RabbitMQ. Other commands: `npm run build`, `npm run start:prod`, `npm run lint`, `npm run seed`, `npm test`.

---

## Project Structure

```
src/
├── main.ts                  # bootstrap: api/v1 prefix, ValidationPipe, TransformInterceptor, GlobalExceptionFilter
├── app.module.ts            # module wiring, RabbitMQ exchanges (*_exchange + .dlx), global middleware
├── config/                  # typeorm/rabbitmq config + Joi validation schema (fail-fast)
├── common/
│   ├── middleware/          # AuthContextMiddleware (JWT or x-device-id guests)
│   ├── guards/              # RolesGuard (deny by default)
│   ├── decorators/          # @Roles(...)
│   ├── filters/             # GlobalExceptionFilter (error envelope, machine codes)
│   ├── interceptors/        # TransformInterceptor (success envelope)
│   ├── outbox/              # OutboxEventEntity, ProcessedEventEntity, OutboxProcessorService, AlertService
│   ├── redis/               # Redis module (cache, OTP/rate-limit counters)
│   ├── mail/                # email sending
│   └── utils/               # hashing, phone masking/normalization, helpers
├── database/seeds/          # seed runner (npm run seed, seeder service in compose)
└── modules/
    ├── auth/                # registration, OTP, login, sessions, guests
    ├── catalog/             # specialties, doctors, clinics, pairings, reviews, favorites, articles
    ├── search/              # unified search, filters, sort, map view
    ├── booking/             # holds, appointments, cancellation/reschedule policy
    ├── payment/             # cards, charges, refunds, webhooks
    ├── notification/        # inbox + push/SMS/email consumers
    ├── prescription/        # prescription files, signed links
    ├── ai-assistant/        # read-only AI tools, limits, spend guardrails
    └── analytics/           # event-fed counters
```

---

## API Endpoints Overview

Base prefix: `/api/v1`. Guests may browse/search; booking, favorites, and notifications require an account.

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register a new user account | Public |
| `POST` | `/api/v1/auth/verify-email` | Verify email address using OTP | Public |
| `POST` | `/api/v1/auth/login` | Authenticate user and issue tokens | Public |
| `POST` | `/api/v1/auth/refresh-token` | Issue a new access token via refresh token | Public |
| `POST` | `/api/v1/auth/resend-otp` | Resend a new verification code | Public |
| `GET` | `/api/v1/auth/me` | Get the current authenticated user's profile | Authenticated |
| `POST` | `/api/v1/booking/holds` | Hold a slot while paying (10 min) | Patient |
| `POST` | `/api/v1/booking/holds/:id/extend` | One 5-minute 3DS extension | Patient |
| `GET` | `/api/v1/booking/appointments/:id/cancellation-preview` | Preview fee consequence (not the decision) | Patient |
| `POST` | `/api/v1/booking/appointments/:id/cancel` | Cancel; server decides refund at confirm time | Patient |
| `POST` | `/api/v1/booking/appointments/:id/reschedule` | Reschedule once, same 24h rule | Patient |

Catalog, search, payment, notification, prescription, and AI-assistant routes follow the same Controller → Use-Case → Service pattern with DTOs and `@Roles(...)` on every route.

---

## Architecture

Full architecture documentation lives in [`docs/architecture.md`](docs/architecture.md). It covers the runtime diagram and compose services, vertical-slice layout, the request lifecycle (middleware → guard → pipe → use-case → interceptor → filter), the transactional outbox flow with exchanges and DLQs, the consumer idempotency contract, concurrency/money guarantees, authN/authZ and abuse protection, and configuration. The live event catalogue is in [`docs/event-catalogue.md`](docs/event-catalogue.md).

---

## Testing

```bash
npm test                                   # unit suites (src, *.spec.ts)
npx jest src/modules/booking/policies/cancellation-policy.spec.ts  # single rule
npm run test:e2e                            # e2e (test/jest-e2e.json)
npm run test:cov                            # coverage
```

Notable: the hold-concurrency proof (`create-hold.concurrent.spec.ts`) is skipped unless `DB_HOST`/`DB_NAME` is set and must run against real Postgres (expects exactly one winner via `23505`). Do not add suites needing RabbitMQ/Stripe/real SMS without a skip guard. Business rules under test: cancellation boundaries (>, <, exactly 24h), availability, booking money paths, authZ (guest blocked, user A vs. user B), consumer idempotency.

---

## Contributing

1. Create a feature branch from `main`.
2. Follow the existing module structure (Controller → Use Case / Service → Repository).
3. Keep domain code `any`-free, add DTOs with `class-validator`, and put every business rule in a use-case/policy with a colocated `*.spec.ts`.
4. Open a pull request with a clear description of the change.
