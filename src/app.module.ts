import { Module, NestModule, MiddlewareConsumer, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { DatabaseModule } from './database/database.module';
import typeormConfig from './config/typeorm.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { AuthModule } from './modules/auth/auth.module';
import { AuthContextMiddleware } from './common/middleware/auth-context.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OutboxModule } from './common/outbox/outbox.module';
import { ScheduleModule } from '@nestjs/schedule';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [typeormConfig, rabbitmqConfig],
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    DatabaseModule,

    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        exchanges: [
          {
            name: 'auth_exchange',
            type: 'topic',
          },
        ],
        uri: configService.get<string>('rabbitmq.uri')!,
        connectionInitOptions: { wait: true },
      }),
      inject: [ConfigService],
    }),

    OutboxModule,
    AuthModule,
  ],

  exports: [RabbitMQModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthContextMiddleware)
      .forRoutes('*');
  }
}