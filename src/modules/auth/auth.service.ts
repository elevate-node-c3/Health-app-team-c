import { Injectable } from '@nestjs/common';
import { SignupDto } from './dto/sign-up.dto';
import { SignupUseCase } from './use-case/signup.use-case';
import { SignInDto } from './dto/sign-in.dto';
import { SignInUseCase } from './use-case/sign-in.use-case';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResendOtpUseCase } from './use-case/resend-otp.use-case';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyEmailUseCase } from './use-case/verify-email.use-case';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshTokenUseCase } from './use-case/refresh-token.use-case';
import { SignOutDto } from './dto/sign-out.dto';
import { SignOutUseCase } from './use-case/sign-out.use-case';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RequestPasswordResetUseCase } from './use-case/request-password-reset.use-case';
import { VerifyPasswordResetUseCase } from './use-case/verify-password-reset.use-case';
import { ResetPasswordUseCase } from './use-case/reset-password.use-case';

@Injectable()
export class AuthService {
    constructor(
        private readonly signupUseCase: SignupUseCase,
        private readonly signInUseCase: SignInUseCase,
        private readonly verifyEmailUseCase: VerifyEmailUseCase,
        private readonly resendOtpUseCase: ResendOtpUseCase,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
        private readonly signOutUseCase: SignOutUseCase,
        private readonly requestPasswordResetUseCase: RequestPasswordResetUseCase,
        private readonly verifyPasswordResetUseCase: VerifyPasswordResetUseCase,
        private readonly resetPasswordUseCase: ResetPasswordUseCase,
    ) {}

    async signup(dto: SignupDto, guestDeviceId?: string) {
        return await this.signupUseCase.execute(dto, guestDeviceId);
    }

    async signIn(dto: SignInDto, guestDeviceId?: string) {
        return await this.signInUseCase.execute(dto, guestDeviceId);
    }

    async signin(dto: SignInDto, guestDeviceId?: string) {
        return this.signIn(dto, guestDeviceId);
    }

    async verifyEmail(dto: VerifyEmailDto) {
        return await this.verifyEmailUseCase.execute(dto);
    }

    async resendOtp(dto: ResendOtpDto) {
        return await this.resendOtpUseCase.execute(dto);
    }

    async refreshToken(dto: RefreshTokenDto) {
        return await this.refreshTokenUseCase.execute(dto);
    }

    async signOut(dto: SignOutDto, requestingUserId: string) {
        return await this.signOutUseCase.signOut(dto, requestingUserId);
    }

    async signOutEverywhere(userId: string) {
        return await this.signOutUseCase.signOutEverywhere(userId);
    }

    async requestPasswordReset(dto: ForgotPasswordDto) {
        return await this.requestPasswordResetUseCase.execute(dto);
    }

    async verifyPasswordReset(dto: VerifyResetCodeDto) {
        return await this.verifyPasswordResetUseCase.execute(dto);
    }

    async resetPassword(dto: ResetPasswordDto) {
        return await this.resetPasswordUseCase.execute(dto);
    }
}
