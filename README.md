# DOCURA Backend API

A robust, scalable, and secure backend system for the **DOCURA** healthcare platform — a doctor appointment booking service. Built with **NestJS**, **TypeScript**, and **PostgreSQL**, following Clean Architecture principles and strict separation of concerns.

---

## 🚀 Key Features

- **Advanced Authentication System** — Secure multi-device session management via a dedicated `RefreshToken` entity, allowing users to stay signed in safely across multiple devices.
- **Token Security** — Refresh tokens are hashed (SHA-256) before being persisted, so a database breach never exposes usable tokens.
- **Email Verification Flow** — OTP-based email verification with built-in security tracking: limited failed attempts and code expiration handling.
- **Event-Driven Architecture** — Domain events (e.g. `user.registered`) are published via **RabbitMQ**, decoupling core business logic (signup) from side effects (sending emails).
- **Transactional Outbox Pattern** — Events are written to the database in the same transaction as the business change, then reliably relayed to RabbitMQ by a background processor — no lost events, even if the app crashes mid-request.
- **Dead Letter Queue (DLQ)** — Messages that repeatedly fail processing (e.g. email delivery) are routed to a dedicated queue for inspection, instead of being silently dropped or retried forever.
- **Modular Architecture** — Organized into distinct Use Cases, Services, and Entities for high testability and easy team handovers.
- **Fully Containerized** — The entire environment (API, PostgreSQL, RabbitMQ, pgAdmin) runs via Docker Compose with hot-reload for local development.

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| Framework | [NestJS](https://nestjs.com/) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | TypeORM |
| Messaging | RabbitMQ (`@golevelup/nestjs-rabbitmq`) |
| Scheduling | `@nestjs/schedule` (outbox processor cron job) |
| Auth | JWT (access + refresh tokens) |
| Containerization | Docker & Docker Compose |

---

## 📁 Project Structure

```
src/
├── common/
│   ├── utils/            # Helper utilities (token generation, hashing, etc.)
│   ├── middleware/        # Global middleware (auth context, etc.)
│   ├── filters/            # Global exception filter
│   └── outbox/             # Transactional outbox entities & processor
└── modules/
    ├── auth/                # Authentication module
    │   ├── entities/        # User & RefreshToken entities
    │   ├── use-case/        # Isolated business logic (SignupUseCase, VerifyEmailUseCase, etc.)
    │   ├── dto/              # Data transfer objects
    │   ├── consumers/        # RabbitMQ event consumers
    │   ├── auth.controller.ts
    │   ├── auth-token.service.ts
    │   └── auth.module.ts
    └── users/                # User management module
```

---

## ⚙️ Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose installed on your machine.

### 1. Clone the Repository

```bash
git clone https://github.com/elevate-node-c3/Health-app-team-c.git
cd Health-app-team-c
```

### 2. Environment Configuration

Create a `.env` file in the project root:

```env
# App
PORT=3000
NODE_ENV=development

# Database
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=docura
DB_PASSWORD=docura
DB_NAME=docura_db
DB_SYNC=true
DB_LOGGING=false

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your_refresh_secret
REFRESH_TOKEN_EXPIRES_IN=7d

# RabbitMQ
RABBITMQ_URI=amqp://guest:guest@rabbitmq:5672
```

### 3. Run Everything via Docker Compose

```bash
docker compose up --build
```

This starts the API, PostgreSQL, RabbitMQ, and pgAdmin — with hot-reload enabled, so code changes are picked up automatically without rebuilding.

To stop the containers:

```bash
docker compose down
```

To stop and wipe all data (fresh start):

```bash
docker compose down -v
```

---

## 📌 API Endpoints Overview

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register a new user account | Public |
| `POST` | `/api/v1/auth/verify-email` | Verify email address using OTP | Public |
| `POST` | `/api/v1/auth/login` | Authenticate user & issue tokens | Public |
| `POST` | `/api/v1/auth/refresh-token` | Generate a new access token via refresh token | Public |
| `POST` | `/api/v1/auth/resend-otp` | Resend a new verification code | Public |
| `GET` | `/api/v1/auth/me` | Get the current authenticated user's profile | Authenticated |

---

## 🧩 Architecture Notes

- **Outbox → RabbitMQ → Consumer flow**: when a user signs up, the `SignupUseCase` saves the new user *and* an outbox event in the same database transaction. A scheduled job (`OutboxProcessorService`) picks up unprocessed events and publishes them to RabbitMQ. This guarantees the event is never lost, even if the process crashes right after the user is created.
- **Consumers are non-throwing by design**: a RabbitMQ consumer failure (e.g. the email provider is down) never retries an unbounded number of times in a tight loop. Failed messages are negatively acknowledged without requeue and routed to a dedicated Dead Letter Queue for later inspection.

---

## 🤝 Contributing

1. Create a feature branch from `main`.
2. Follow the existing module structure (Controller → Use Case / Service → Repository).
3. Open a pull request with a clear description of the change.