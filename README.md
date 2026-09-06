# NestJS + PostgreSQL Starter

مشروع Node.js جاهز باستخدام NestJS و PostgreSQL مع Docker.

## البنية (Structure)

```
nestjs-postgres-project/
├── src/
│   ├── config/
│   │   └── typeorm.config.ts     # إعدادات الاتصال بقاعدة البيانات
│   ├── database/
│   │   └── database.module.ts    # موديول ربط TypeORM
│   ├── app.controller.ts
│   ├── app.service.ts
│   ├── app.module.ts
│   └── main.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

## التشغيل محليًا (بدون Docker)

```bash
npm install
cp .env.example .env
npm run start:dev
```

تأكد إن عندك PostgreSQL شغال على جهازك ومطابق لبيانات ملف `.env`.

## التشغيل باستخدام Docker (الأسهل)

```bash
cp .env.example .env
docker compose up --build
```

هيشغل لك:
- **api** → NestJS app على `http://localhost:3000`
- **postgres** → قاعدة بيانات PostgreSQL على بورت `5432`
- **pgadmin** → واجهة إدارة قاعدة البيانات على `http://localhost:5050`
  (login: `admin@admin.com` / `admin`)

للإيقاف:
```bash
docker compose down
```

لإيقاف مع حذف الداتا كمان:
```bash
docker compose down -v
```

## إضافة موديول جديد (مثال users)

```bash
npx nest generate module users
npx nest generate controller users
npx nest generate service users
```

وبعدين اعمل Entity وربطها بـ `TypeOrmModule.forFeature([User])` جوه `UsersModule`.

## Endpoints جاهزة

- `GET /` → رسالة ترحيب
- `GET /health` → health check

## ملاحظات مهمة

- `DB_SYNC=true` مناسب للتطوير فقط. في الإنتاج استخدم Migrations بدل `synchronize`.
- غيّر بيانات الباسورد الافتراضية قبل ما تنشر المشروع (deploy).
