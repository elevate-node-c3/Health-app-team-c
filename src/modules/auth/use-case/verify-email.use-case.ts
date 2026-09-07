import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../entities/user.entity';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';

@Injectable()
export class VerifyEmailUseCase {
    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly tokenUtils: TokenUtils,
        private readonly authTokenService: AuthTokenService,
    ) { }

    async execute(dto: VerifyEmailDto) {
        const normalizedEmail = dto.email.toLowerCase().trim();

        const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
        if (!user) {
            throw new NotFoundException('This email is not registered');

        }

        if (user.isVerified) {
            throw new BadRequestException('This account is already verified.');
        }

        if (user.failedAttemptsCount >= 5) {
            throw new BadRequestException('Too many failed attempts. Please request a new verification code.');
        }

        const now = new Date();
        if (!user.code_expires_at || user.code_expires_at < now) {
            throw new BadRequestException('Verification code has expired. Please request a new one.');
        }

        if (user.verificationCode !== dto.code) {
            user.failedAttemptsCount += 1;
            await this.userRepository.save(user);
            throw new BadRequestException(`Invalid verification code. ${5 - user.failedAttemptsCount} attempts remaining.`);
        }

        user.isVerified = true;
        user.status = UserStatus.PATIENT;
        user.verificationCode = null;
        user.code_expires_at = null;
        user.failedAttemptsCount = 0;

        await this.userRepository.save(user);

        const tokens = this.tokenUtils.generateTokens({
            sub: user.id,
            email: user.email,
            status: user.status,
        });

        await this.authTokenService.saveRefreshToken(user.id, tokens.refreshToken);

        return {
            message: 'Email verified successfully.',
            data: {
                ...tokens,
                isVerified: true,
            },
        };
    }
}