import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../entities/user.entity';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import * as crypto from 'crypto';

@Injectable()
export class VerifyEmailUseCase {
    private readonly logger = new Logger(VerifyEmailUseCase.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly tokenUtils: TokenUtils,
        private readonly authTokenService: AuthTokenService,
        private readonly dataSource: DataSource,
        private readonly outboxProcessorService: OutboxProcessorService,
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
            throw new BadRequestException(
                `Invalid verification code. ${5 - user.failedAttemptsCount} attempts remaining.`,
            );
        }

        // ── All checks passed — update user + issue token family + outbox in one transaction ──
        user.isVerified = true;
        user.status = UserStatus.PATIENT;
        user.verificationCode = null;
        user.code_expires_at = null;
        user.failedAttemptsCount = 0;

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let savedOutboxEventId: string;
        let rawRefreshToken: string;
        let familyId: string;

        try {
            await queryRunner.manager.save(user);

            // Issue token family inside the transaction
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
                    deviceLabel: null,
                    expiresAt,
                }),
            );

            // Publish session.created domain event
            const outboxEvent = queryRunner.manager.create(OutboxEventEntity, {
                aggregateType: 'SESSION',
                eventType: 'session.created',
                payload: {
                    userId: user.id,
                    familyId,
                    deviceLabel: null,
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

        // Generate access token (pure in-memory, outside the transaction)
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
                    this.logger.error(`Outbox publish failed for session.created after email verify: ${err.message}`);
                });
            });
        }

        return {
            message: 'Email verified successfully.',
            data: {
                accessToken,
                refreshToken: rawRefreshToken,
                expiresIn: 900,
                isVerified: true,
            },
        };
    }
}
