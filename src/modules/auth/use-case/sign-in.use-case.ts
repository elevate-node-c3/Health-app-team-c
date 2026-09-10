import { Injectable, UnauthorizedException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { HashHelper } from '../../../common/utils/hash.util';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { SignInDto } from '../dto/sign-in.dto';

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
    ) {}

    async execute(dto: SignInDto) {
        const normalizedEmail = dto.email.toLowerCase().trim();

        // 1 — Find the user
        const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
        if (!user) {
            // Constant-time-ish: still run hash compare to avoid timing leaks
            await HashHelper.comparePasswords('_dummy_', '$2b$10$dummydummydummydummydumm');
            throw new UnauthorizedException({
                code: 'INVALID_CREDENTIALS',
                messageKey: 'errors.auth.invalid_credentials',
            });
        }

        // 2 — Verify password
        const passwordValid = await HashHelper.comparePasswords(dto.password, user.passwordHash);
        if (!passwordValid) {
            throw new UnauthorizedException({
                code: 'INVALID_CREDENTIALS',
                messageKey: 'errors.auth.invalid_credentials',
            });
        }

        // 3 — Require email verification
        if (!user.isVerified) {
            throw new UnauthorizedException({
                code: 'EMAIL_NOT_VERIFIED',
                messageKey: 'errors.auth.email_not_verified',
            });
        }

        // 4 — Issue token family + publish session.created — all in one transaction
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let savedOutboxEventId: string;
        let rawRefreshToken: string;
        let familyId: string;

        try {
            // issueTokenFamily uses its own repository but we replicate the insert inside
            // the transaction so the outbox write and token insert are atomic.
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

        // 5 — Generate access token (outside the transaction — pure in-memory)
        const accessToken = this.tokenUtils.generateAccessToken({
            sub: user.id,
            email: user.email,
            status: user.status,
            familyId,
        });

        // 6 — Fire-and-forget outbox publish
        if (savedOutboxEventId) {
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(savedOutboxEventId).catch((err) => {
                    this.logger.error(`Outbox publish failed for session.created ${savedOutboxEventId}: ${err.message}`);
                });
            });
        }

        return {
            message: 'Signed in successfully.',
            data: {
                accessToken,
                refreshToken: rawRefreshToken,
                expiresIn: 900, // 15 minutes in seconds
                userId: user.id,
                status: user.status,
            },
        };
    }
}
