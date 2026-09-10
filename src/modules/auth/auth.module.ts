import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserEntity } from './entities/user.entity';
import { GuestSearchEntity } from './entities/guest-search.entity';
import { TokenUtils } from '../../common/utils/token.utils';
import { SignupUseCase } from './use-case/signup.use-case';
import { VerifyEmailUseCase } from './use-case/verify-email.use-case';
import { ResendOtpUseCase } from './use-case/resend-otp.use-case';
import { SignInUseCase } from './use-case/sign-in.use-case';
import { RefreshTokenUseCase } from './use-case/refresh-token.use-case';
import { SignOutUseCase } from './use-case/sign-out.use-case';
import { JwtModule } from '@nestjs/jwt';
import { MailService } from 'src/common/mail/mail.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { AuthTokenService } from './auth-token.service';
import { AuthRabbitMQConsumer } from './consumers/auth-rabbitmq.consumer';
import { SessionRabbitMQConsumer } from './consumers/session-rabbitmq.consumer';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from 'src/common/outbox/services/outbox-processor.service';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserEntity,
            GuestSearchEntity,
            RefreshTokenEntity,
            OutboxEventEntity,
        ]),
        JwtModule.register({
            global: false,
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        SignupUseCase,
        VerifyEmailUseCase,
        ResendOtpUseCase,
        SignInUseCase,
        RefreshTokenUseCase,
        SignOutUseCase,
        TokenUtils,
        MailService,
        AuthTokenService,
        AuthRabbitMQConsumer,
        SessionRabbitMQConsumer,
        OutboxProcessorService,
    ],
    exports: [AuthService, AuthTokenService, TokenUtils],
})
export class AuthModule {}