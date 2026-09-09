import { Body, Controller, Get, Post, Req, Headers, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SignupDto } from './dto/sign-up.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { UserStatus } from './entities/user.entity';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

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