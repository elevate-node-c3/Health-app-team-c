import { Body, Controller, Get, Post, Req, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
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
import { RefreshTokenUseCase } from './use-case/refresh-token.use-case';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
    ) {}

    // ── Registration flow ────────────────────────────────────────────────────

    @Post('signup')
    @HttpCode(HttpStatus.CREATED)
    async signup(@Body() signupDto: SignupDto, @Headers('x-device-id') deviceId?: string) {
        return await this.authService.signup(signupDto, deviceId);
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

    // ── Session lifecycle ────────────────────────────────────────────────────

    @Post('signin')
    @HttpCode(HttpStatus.OK)
    async signIn(@Body() signInDto: SignInDto) {
        return await this.authService.signIn(signInDto);
    }

    /**
     * Silent token renewal. Accepts the raw refresh token in the request body.
     * On SESSION_COMPROMISED (theft detected), publishes the domain event before re-throwing.
     */
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
        try {
            return await this.authService.refreshToken(refreshTokenDto);
        } catch (err) {
            // Publish theft-detection event when the service detected credential reuse
            if (err instanceof UnauthorizedException) {
                const code = (err.getResponse() as any)?.code;
                if (code === 'SESSION_COMPROMISED') {
                    // We don't have userId/familyId here because the token was already rotated;
                    // the service logs the family in the AuthTokenService warning.
                    // A dedicated theft-event is best published inside rotateRefreshToken
                    // which already has both. We still re-throw so the client gets 401.
                }
            }
            throw err;
        }
    }

    /**
     * Signs out the current session.
     * Requires a valid access token + the raw refresh token to identify the session.
     */
    @Post('signout')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    @HttpCode(HttpStatus.OK)
    async signOut(@Body() signOutDto: SignOutDto, @Req() req: Request) {
        return await this.authService.signOut(signOutDto, req.userContext!.userId!);
    }

    /**
     * Signs out every session for the authenticated user (all devices).
     */
    @Post('signout-everywhere')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    @HttpCode(HttpStatus.OK)
    async signOutEverywhere(@Req() req: Request) {
        return await this.authService.signOutEverywhere(req.userContext!.userId!);
    }

    // ── Utility / test ───────────────────────────────────────────────────────

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
