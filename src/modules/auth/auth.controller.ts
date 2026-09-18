import { Body, Controller, Get, Post, Req, UseGuards, HttpStatus, HttpCode, Headers, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SignupDto } from './dto/sign-up.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SignOutDto } from './dto/sign-out.dto';
import { UserStatus } from './entities/user.entity';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenUseCase } from './use-case/refresh-token.use-case';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
    ) {}

    @Post('signup')
    @HttpCode(HttpStatus.CREATED)
    async signup(@Body() signupDto: SignupDto, @Headers('x-device-id') deviceId?: string) {
        return await this.authService.signup(signupDto, deviceId);
    }

    @Post('signin')
    @HttpCode(HttpStatus.OK)
    async signin(@Body() signinDto: SignInDto, @Headers('x-device-id') deviceId?: string) {
        return await this.authService.signIn(signinDto, deviceId);
    }

    @Post('verify-email')
    @HttpCode(HttpStatus.OK)
    async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
        return await this.authService.verifyEmail(verifyEmailDto);
    }

    @Post('resend-otp')
    @HttpCode(HttpStatus.OK)
    async resendOtp(@Body() resendOtpDto: ResendOtpDto) {
        return await this.authService.resendOtp(resendOtpDto);
    }

    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    async requestPasswordReset(@Body() forgotPasswordDto: ForgotPasswordDto) {
        return await this.authService.requestPasswordReset(forgotPasswordDto);
    }

    @Post('verify-reset-code')
    @HttpCode(HttpStatus.OK)
    async verifyPasswordReset(@Body() verifyResetCodeDto: VerifyResetCodeDto) {
        return await this.authService.verifyPasswordReset(verifyResetCodeDto);
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
        return await this.authService.resetPassword(resetPasswordDto);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
        try {
            return await this.authService.refreshToken(refreshTokenDto);
        } catch (err) {
            if (err instanceof UnauthorizedException) {
                const code = (err.getResponse() as any)?.code;
                if (code === 'SESSION_COMPROMISED') {
                }
            }
            throw err;
        }
    }

    @Post('signout')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    @HttpCode(HttpStatus.OK)
    async signOut(@Body() signOutDto: SignOutDto, @Req() req: Request) {
        return await this.authService.signOut(signOutDto, req.userContext!.userId!);
    }

    @Post('signout-everywhere')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    @HttpCode(HttpStatus.OK)
    async signOutEverywhere(@Req() req: Request) {
        return await this.authService.signOutEverywhere(req.userContext!.userId!);
    }

    @Get('me')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.GUEST, UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    @HttpCode(HttpStatus.OK)
    getProfile(@Req() req: Request) {
        return {
            message: 'User context retrieved successfully',
            userContext: req.userContext,
        };
    }

    @Get('book-appointment-test')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    testBooking(@Req() req: Request) {
        return {
            message: 'Access granted! You are a verified patient and can book appointments.',
            userId: req.userContext?.userId,
        };
    }
}
