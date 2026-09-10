import { Injectable } from '@nestjs/common';
import { SignupDto } from './dto/sign-up.dto';
import { SignupUseCase } from './use-case/signup.use-case';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResendOtpUseCase } from './use-case/resend-otp.use-case';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyEmailUseCase } from './use-case/verify-email.use-case';
import { SignInDto } from './dto/sign-in.dto';
import { SignInUseCase } from './use-case/sign-in.use-case';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshTokenUseCase } from './use-case/refresh-token.use-case';
import { SignOutDto } from './dto/sign-out.dto';
import { SignOutUseCase } from './use-case/sign-out.use-case';


@Injectable()
export class AuthService {
    constructor(
        private readonly signupUseCase: SignupUseCase,
        private readonly verifyEmailUseCase: VerifyEmailUseCase,
        private readonly resendOtpUseCase: ResendOtpUseCase,
        private readonly signInUseCase: SignInUseCase,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
        private readonly signOutUseCase: SignOutUseCase,
    ) {}

    async signup(dto: SignupDto) {
        return await this.signupUseCase.execute(dto);
    }

    async verifyEmail(dto: VerifyEmailDto) {
        return await this.verifyEmailUseCase.execute(dto);
    }

    async resendOtp(dto: ResendOtpDto) {
        return await this.resendOtpUseCase.execute(dto);
    }

    async signIn(dto: SignInDto) {
        return await this.signInUseCase.execute(dto);
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
}