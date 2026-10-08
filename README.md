# DOCURA Backend API

DOCURA is a doctor appointment booking backend for patients in Egypt. Patients can discover doctors, check real availability, book and pay online, and manage their visits. It is built with NestJS, PostgreSQL, RabbitMQ and Redis, with an event-driven design for notifications and reminders.

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

- **Doctor discovery** — search by specialty or name, filter and sort, map view, and detailed doctor profiles with clinic schedules.
- **Guest access** — browse, search and view availability without an account; an account is only needed to book.
- **Authentication** — registration, phone verification via OTP, sign-in with email or phone, Google and Apple sign-in, and persistent sessions.
- **Booking and payments** — temporary slot holds during checkout, online card payment in EGP, instant in-app confirmation plus SMS, email and push.
- **Manage bookings** — upcoming, completed and cancelled history with cancel, reschedule, re-book and prescription download.
- **Cancellations and refunds** — free and non-refundable cases handled with clear pre-confirm messaging and refund tracking.
- **Engagement** — notifications, favorites, medical articles, and appointment reminders.
- **Health assistant** — human ask-a-doctor questions plus an instant AI assistant for general guidance.

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | [NestJS](https://nestjs.com/) 10 |
| Language | TypeScript |
| Database | PostgreSQL + TypeORM |
| Messaging | RabbitMQ (`@golevelup/nestjs-rabbitmq`) |
| Cache | Redis (`ioredis`) |
| Scheduling | `@nestjs/schedule` |
| Auth | JWT access + refresh tokens |
| Validation | `class-validator` + `ValidationPipe` |
| Config | `@nestjs/config` + Joi |
| Payments | Stripe |
| Containerization | Docker & Docker Compose |

---

## How It Works

1. **Request flow** — authentication middleware resolves the caller (user or guest), guards check access, DTOs are validated, controllers delegate to use-cases, and responses use a single success/error envelope.
2. **Discovery** — doctors, clinics, schedules and fees are modeled per clinic, powering search, filters and per-clinic availability.
3. **Booking** — a slot is held during payment, availability is re-checked before confirming, and concurrent bookings for the same slot are resolved so only one succeeds.
4. **Cancellations** — cancelling frees the slot, cancels pending reminders, sends a notification, and issues a refund where applicable.
5. **Background work** — state changes publish domain events via a transactional outbox; notification, reminder and analytics consumers process them independently with retries.

---

## Basic Workflow

**Patient books a visit:**

```
browse doctors → search / filter / view profile
  → sign up + verify phone → pick clinic + date + time
  → hold slot → pay by card → confirmation
```

**Patient cancels:**

```
open booking → preview cancellation → confirm
  → slot released → refund issued if applicable → notification sent
```

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

Fill in the required variables (the app fails fast on missing values). Inside the Docker network, hosts are service names:

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
├── app.module.ts            # module wiring and global middleware
├── config/                  # typeorm/rabbitmq config + validation schema
├── common/
│   ├── middleware/          # auth context (JWT or guest device id)
│   ├── guards/              # access control
│   ├── decorators/          # @Roles(...)
│   ├── filters/             # global error handling
│   ├── interceptors/        # response envelope
│   ├── outbox/              # transactional outbox + event relay
│   ├── redis/               # cache and counters
│   ├── mail/                # email sending
│   └── utils/               # hashing, phone helpers
├── database/seeds/          # seed runner
└── modules/
    ├── auth/                # registration, OTP, login, sessions
    ├── catalog/             # specialties, doctors, clinics, reviews, favorites, articles
    ├── search/              # search, filters, sort, map view
    ├── booking/             # holds, appointments, cancellation/reschedule
    ├── payment/             # cards, charges, refunds, webhooks
    ├── notification/        # inbox + push/SMS/email consumers
    ├── prescription/        # prescription files
    ├── ai-assistant/        # assistant tools and limits
    └── analytics/           # event-fed counters
```

---

## API Endpoints Overview

Base prefix: `/api/v1`. Browsing and search are open to guests; booking, favorites and notifications require a signed-in user.

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register a new user account | Public |
| `POST` | `/api/v1/auth/verify-email` | Verify email address using OTP | Public |
| `POST` | `/api/v1/auth/login` | Authenticate user and issue tokens | Public |
| `POST` | `/api/v1/auth/refresh-token` | Issue a new access token via refresh token | Public |
| `POST` | `/api/v1/auth/resend-otp` | Resend a new verification code | Public |
| `GET` | `/api/v1/auth/me` | Get the current authenticated user's profile | Authenticated |
| `POST` | `/api/v1/booking/holds` | Hold a slot while paying | Patient |
| `POST` | `/api/v1/booking/holds/:id/extend` | Extend a hold during bank confirmation | Patient |
| `GET` | `/api/v1/booking/appointments/:id/cancellation-preview` | Preview cancellation outcome | Patient |
| `POST` | `/api/v1/booking/appointments/:id/cancel` | Cancel an appointment | Patient |
| `POST` | `/api/v1/booking/appointments/:id/reschedule` | Reschedule an appointment | Patient |

See the controllers in `src/modules/` for the full route list. All routes validate input with DTOs and return the shared envelope.

---

## Architecture

Full architecture documentation lives in [`docs/architecture.md`](docs/architecture.md). The live event catalogue is in [`docs/event-catalogue.md`](docs/event-catalogue.md).

High level: vertical feature modules behind a validated request pipeline, Postgres as the source of truth with constraints guarding slots and money, RabbitMQ for domain events via a transactional outbox with idempotent consumers and dead-lettering, plus Redis and scheduled jobs for expiry, reminders and counters.

---

## Testing

```bash
npm test                                   # unit suites (src, *.spec.ts)
npx jest src/modules/booking/policies/cancellation-policy.spec.ts  # single rule
npm run test:e2e                            # e2e (test/jest-e2e.json)
npm run test:cov                            # coverage
```

Unit tests cover cancellation, availability, booking, validation, authorization and event consumers, plus integration tests for the book-to-confirm and cancel-to-refund flows.

---

## Contributing

1. Create a feature branch from `main`.
2. Follow the existing module structure (Controller → Use Case / Service → Repository).
3. Add DTO validation and tests for new behavior.
4. Open a pull request with a clear description of the change.
