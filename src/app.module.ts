import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import typeormConfig from './config/typeorm.config';
import { AuthModule } from './modules/auth/auth.module';
import { AuthContextMiddleware } from './common/middleware/auth-context.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [typeormConfig],
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AuthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthContextMiddleware)
      .forRoutes('*');
  }
}