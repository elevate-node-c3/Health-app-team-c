import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { SigninDto } from '../dto/sign-in.dto';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { HashHelper } from '../../../common/utils/hash.util';
import { normalizeEgyptianPhoneNumber } from '../../../common/utils/phone.util';
import { PromoteGuestUseCase } from './promote-guest.use-case';

@Injectable()
export class SigninUseCase {
    private readonly logger = new Logger(SigninUseCase.name);
    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly tokenUtils: TokenUtils,
        private readonly authTokenService: AuthTokenService,
        private readonly promoteGuestUseCase: PromoteGuestUseCase,
    ) { }

    async execute(dto: SigninDto, guestDeviceId?: string) {
        const identifier = dto.identifier.trim();
        const isEmailAttempt = identifier.includes('@');
        let user: UserEntity | null = null;

        if (isEmailAttempt) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(identifier)) {
                throw new BadRequestException('Invalid email address');
            }

            const normalizedEmail = identifier.toLowerCase();
            user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
            if (!user) {
                throw new BadRequestException('Invalid email address');
            }
        } else {
            let phoneToNormalize = identifier;
            if (phoneToNormalize.startsWith('20') && !phoneToNormalize.startsWith('+20')) {
                phoneToNormalize = '+' + phoneToNormalize;
            }
            const normalizedPhone = normalizeEgyptianPhoneNumber(phoneToNormalize);

            const phoneRegex = /^\+201[0125]\d{8}$/;
            if (!phoneRegex.test(normalizedPhone)) {
                throw new BadRequestException('Invalid Phone Number');
            }

            user = await this.userRepository.findOne({ where: { phoneNumber: normalizedPhone } });
            if (!user) {
                throw new BadRequestException('Invalid Phone Number');
            }
        }

        if (!user.passwordHash) {
            throw new BadRequestException('Incorrect Password');
        }

        const isPasswordValid = await HashHelper.comparePasswords(dto.password, user.passwordHash);
        if (!isPasswordValid) {
            throw new BadRequestException('Incorrect Password');
        }

        // Migrate guest session searches if guest device ID is provided
        const normalizedGuestDeviceId = guestDeviceId?.trim();
        if (normalizedGuestDeviceId) {
            try {
                await this.promoteGuestUseCase.execute({
                    guestDeviceId: normalizedGuestDeviceId,
                    userId: user.id,
                });
            } catch (err: any) {
                this.logger.warn(`Guest promotion during signin failed: ${err.message}`);
            }
        }

        const tokens = this.tokenUtils.generateTokens({
            sub: user.id,
            email: user.email,
            status: user.status,
        });

        await this.authTokenService.saveRefreshToken(user.id, tokens.refreshToken);

        return {
            statusCode: 200,
            message: 'Sign in successful',
            data: {
                user: {
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    status: user.status,
                    isVerified: user.isVerified,
                },
                tokens,
            },
        };
    }
}
