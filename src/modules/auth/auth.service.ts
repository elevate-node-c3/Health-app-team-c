import { Injectable } from '@nestjs/common';
import { SignupDto } from './dto/sign-up.dto';
import { SignupUseCase } from './use-case/signup.use-case';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResendOtpUseCase } from './use-case/resend-otp.use-case';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyEmailUseCase } from './use-case/verify-email.use-case';


@Injectable()
export class AuthService {
    constructor(
        private readonly signupUseCase: SignupUseCase,
        private readonly verifyEmailUseCase: VerifyEmailUseCase,
        private readonly resendOtpUseCase: ResendOtpUseCase,
    ) { }

    async signup(dto: SignupDto, guestDeviceId?: string) {
        return await this.signupUseCase.execute(dto, guestDeviceId);
    }

    async verifyEmail(dto: VerifyEmailDto) {
        return await this.verifyEmailUseCase.execute(dto);
    }

    async resendOtp(dto: ResendOtpDto) {
        return await this.resendOtpUseCase.execute(dto);
    }

}