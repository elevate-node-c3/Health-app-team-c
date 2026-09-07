DOCURA Backend APIA robust, scalable, and secure backend system for the DOCURA healthcare platform, engineered using NestJS, TypeScript, and PostgreSQL, adhering strictly to Clean Architecture principles and Separation of Concerns.🚀 Key FeaturesAdvanced Authentication System: Secure multi-device session management using a dedicated RefreshTokenEntity relationship, ensuring users can stay logged in across multiple devices safely.Token Security (Hashing): Refresh tokens are securely hashed (SHA-256) before persistence in the database to mitigate security risks in case of data breaches.Email Verification Flow: OTP-based email verification with built-in security tracking (failed attempt limits and code expiration handling).Modular Architecture: Built with distinct Use-Cases, Services, and Entities to maintain high testability and clean code maintainability for team handovers.Fully Containerized: Complete environment runs seamlessly inside Docker containers.🛠️ Tech StackFramework: NestJS (Node.js framework)Language: TypeScriptDatabase: PostgreSQLORM: TypeORMContainerization: Docker & Docker Compose📁 Project StructurePlaintextsrc/
├── common/
│   ├── utils/         # Helper utilities (Token generators, etc.)
│   └── middlewares/   # Global and route middlewares (Auth context, etc.)
└── modules/
    ├── auth/          # Authentication module
    │   ├── entities/  # User & RefreshToken entities
    │   ├── use-cases/ # Isolated business logic (VerifyEmailUseCase, etc.)
    │   ├── dto/       # Data transfer objects
    │   ├── auth.controller.ts
    │   ├── auth-token.service.ts
    │   └── auth.module.ts
    └── users/         # User management module
⚙️ Getting Started & InstallationPrerequisitesEnsure you have Docker and Docker Compose installed on your machine.1. Clone the RepositoryBashgit clone https://github.com/elevate-node-c3/Health-app-team-c.git
cd Health-app-team-c
2. Environment ConfigurationCreate a .env file in the root directory based on your environment settings:مقتطف الرمزPORT=3000
DB_HOST=postgres
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=docura_db
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your_refresh_secret
REFRESH_TOKEN_EXPIRES_IN=7d
3. Run Everything via Docker ComposeBuild and run the entire application and database containers with a single command:Bashdocker-compose up --build -d
To stop the containers when needed:Bashdocker-compose down
📌 API Endpoints OverviewMethodEndpointDescriptionAccessPOST/api/v1/auth/signupRegister a new user accountPublicPOST/api/v1/auth/verify-emailVerify email address using OTPPublicPOST/api/v1/auth/loginAuthenticate user & issue tokensPublicPOST/api/v1/auth/refresh-tokenGenerate new access token via refresh tokenPublic