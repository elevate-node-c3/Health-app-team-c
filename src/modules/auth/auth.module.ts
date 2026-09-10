import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserEntity } from './entities/user.entity';
import { GuestSearchEntity } from './entities/guest-search.entity';
import { UserSearchEntity } from './entities/user-search.entity';
import { GuestPromotionEntity } from './entities/guest-promotion.entity';
import { TokenUtils } from '../../common/utils/token.utils';
import { SignupUseCase } from './use-case/signup.use-case';
import { VerifyEmailUseCase } from './use-case/verify-email.use-case';
import { ResendOtpUseCase } from './use-case/resend-otp.use-case';
import { PromoteGuestUseCase } from './use-case/promote-guest.use-case';
import { JwtModule } from '@nestjs/jwt';
import { MailService } from 'src/common/mail/mail.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { AuthTokenService } from './auth-token.service';
import { AuthRabbitMQConsumer } from './consumers/auth-rabbitmq.consumer';
import { GuestPromotionConsumer } from './consumers/guest-promotion.consumer';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from 'src/common/outbox/services/outbox-processor.service';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { RequestPasswordResetUseCase } from './use-case/request-password-reset.use-case';
import { VerifyPasswordResetUseCase } from './use-case/verify-password-reset.use-case';
import { ResetPasswordUseCase } from './use-case/reset-password.use-case';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserEntity,
            GuestSearchEntity,
            UserSearchEntity,
            GuestPromotionEntity,
            RefreshTokenEntity,
            OutboxEventEntity,
            ProcessedEventEntity,
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
        RequestPasswordResetUseCase,
        VerifyPasswordResetUseCase,
        ResetPasswordUseCase,
        PromoteGuestUseCase,
        TokenUtils,
        MailService,
        AuthTokenService,
        AuthRabbitMQConsumer,
        GuestPromotionConsumer,
        OutboxProcessorService,
    ],
    exports: [AuthService, TokenUtils],
})
export class AuthModule { }