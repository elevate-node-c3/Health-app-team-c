import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'nestjs_db',
    autoLoadEntities: true,
    synchronize: process.env.DB_SYNC === 'true', // false in production, use migrations instead
    migrations: [__dirname + '/../database/migrations/*{.js,.ts}'],
    migrationsRun: false, // prod runs migrations via `npm run migration:run`
    logging: process.env.DB_LOGGING === 'true',
  }),
);
