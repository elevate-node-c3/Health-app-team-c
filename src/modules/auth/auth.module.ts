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
import { JwtModule } from '@nestjs/jwt';
import { UserRegisteredListener } from './listeners/user-registered.listener';
import { MailService } from 'src/common/mail/mail.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { AuthTokenService } from './auth-token.service';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserEntity,
            GuestSearchEntity,
            RefreshTokenEntity
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
        TokenUtils,
        UserRegisteredListener,
        MailService,
        AuthTokenService,
    ],
    exports: [AuthService, TokenUtils],
})
export class AuthModule { }