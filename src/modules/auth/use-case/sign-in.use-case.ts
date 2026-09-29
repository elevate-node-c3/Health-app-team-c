import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { HashHelper } from '../../../common/utils/hash.util';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { SignInDto } from '../dto/sign-in.dto';
import { normalizeEgyptianPhoneNumber } from '../../../common/utils/phone.util';
import { PromoteGuestUseCase } from './promote-guest.use-case';

@Injectable()
export class SignInUseCase {
    private readonly logger = new Logger(SignInUseCase.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly tokenUtils: TokenUtils,
        private readonly authTokenService: AuthTokenService,
        private readonly dataSource: DataSource,
        private readonly outboxProcessorService: OutboxProcessorService,
        private readonly promoteGuestUseCase: PromoteGuestUseCase,
    ) { }

    async execute(dto: SignInDto, guestDeviceId?: string) {
        const rawIdentifier = ((dto as any).identifier ?? (dto as any).email ?? '').trim();
        if (!rawIdentifier) {
            throw new BadRequestException('Email or phone number cannot be blank.');
        }
        const isEmailAttempt = rawIdentifier.includes('@');
        let user: UserEntity | null = null;

        if (isEmailAttempt) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(rawIdentifier)) {
                throw new BadRequestException('Invalid email address');
            }
            const normalizedEmail = rawIdentifier.toLowerCase();
            user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
        } else {
            let phoneToNormalize = rawIdentifier;
            if (phoneToNormalize.startsWith('20') && !phoneToNormalize.startsWith('+20')) {
                phoneToNormalize = '+' + phoneToNormalize;
            }
            const normalizedPhone = normalizeEgyptianPhoneNumber(phoneToNormalize);
            const phoneRegex = /^\+201[0125]\d{8}$/;
            if (!phoneRegex.test(normalizedPhone)) {
                throw new BadRequestException('Invalid Phone Number');
            }
            user = await this.userRepository.findOne({ where: { phoneNumber: normalizedPhone } });
        }

        if (!user) {
            await HashHelper.comparePasswords('_dummy_', '$2b$10$dummydummydummydummydumm');
            throw new UnauthorizedException({
                code: 'INVALID_CREDENTIALS',
                messageKey: 'errors.auth.invalid_credentials',
            });
        }

        if (!user.passwordHash) {
            throw new BadRequestException('Incorrect Password');
        }

        const passwordValid = await HashHelper.comparePasswords(dto.password, user.passwordHash);
        if (!passwordValid) {
            throw new UnauthorizedException({
                code: 'INVALID_CREDENTIALS',
                messageKey: 'errors.auth.invalid_credentials',
            });
        }

        if (!user.isVerified) {
            throw new UnauthorizedException({
                code: 'EMAIL_NOT_VERIFIED',
                messageKey: 'errors.auth.email_not_verified',
            });
        }

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

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let savedOutboxEventId: string;
        let rawRefreshToken: string;
        let familyId: string;

        try {
            const crypto = await import('crypto');
            familyId = crypto.randomUUID();
            rawRefreshToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            await queryRunner.manager.getRepository('refresh_tokens').save(
                queryRunner.manager.getRepository('refresh_tokens').create({
                    familyId,
                    userId: user.id,
                    tokenHash,
                    replacedByTokenHash: null,
                    revokedAt: null,
                    deviceLabel: dto.deviceLabel ?? null,
                    expiresAt,
                }),
            );

            const outboxEvent = queryRunner.manager.create(OutboxEventEntity, {
                aggregateType: 'SESSION',
                eventType: 'session.created',
                exchange: 'auth_exchange',
                routingKey: 'session.created',
                payload: {
                    userId: user.id,
                    familyId,
                    deviceLabel: dto.deviceLabel ?? null,
                    createdAt: new Date().toISOString(),
                },
                isProcessed: false,
            });
            const savedEvent = await queryRunner.manager.save(outboxEvent);
            savedOutboxEventId = savedEvent.id;

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }

        const accessToken = this.tokenUtils.generateAccessToken({
            sub: user.id,
            email: user.email,
            status: user.status,
            familyId,
            fullName: user.fullName,
        });

        if (savedOutboxEventId) {
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(savedOutboxEventId).catch((err) => {
                    this.logger.error(`Outbox publish failed for session.created ${savedOutboxEventId}: ${err.message}`);
                });
            });
        }

        const tokens = { accessToken, refreshToken: rawRefreshToken };

        return {
            message: 'Signed in successfully.',
            statusCode: 200,
            data: {
                accessToken,
                refreshToken: rawRefreshToken,
                expiresIn: 900,
                userId: user.id,
                status: user.status,
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
