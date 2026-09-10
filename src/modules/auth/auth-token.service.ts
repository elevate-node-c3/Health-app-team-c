import {
    Injectable,
    UnauthorizedException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import * as crypto from 'crypto';

/** How long (ms) an already-replaced token is still accepted to handle concurrent refreshes. */
const ROTATION_GRACE_MS = 10_000;

/** Lifetime of a refresh token in days. */
const REFRESH_TOKEN_TTL_DAYS = 7;

export interface IssuedTokenFamily {
    /** Raw refresh token to return to the client. Never stored in DB. */
    rawRefreshToken: string;
    /** Family UUID that must be embedded in the access token. */
    familyId: string;
}

export interface RotationResult {
    rawRefreshToken: string;
    familyId: string;
    userId: string;
    userStatus: string;
    userEmail: string;
}

@Injectable()
export class AuthTokenService {
    private readonly logger = new Logger(AuthTokenService.name);

    constructor(
        @InjectRepository(RefreshTokenEntity)
        private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
        private readonly dataSource: DataSource,
    ) {}

    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    private generateRawToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    private expiresInDays(days: number): Date {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d;
    }

    /**
     * Creates the first token in a new family (called on sign-in or email verification).
     * A new UUID is minted as the familyId; all future rotations share it.
     */
    async issueTokenFamily(
        userId: string,
        deviceLabel?: string,
    ): Promise<IssuedTokenFamily> {
        const familyId = crypto.randomUUID();
        const rawRefreshToken = this.generateRawToken();
        const tokenHash = this.hashToken(rawRefreshToken);
        const expiresAt = this.expiresInDays(REFRESH_TOKEN_TTL_DAYS);

        const entity = this.refreshTokenRepository.create({
            familyId,
            userId,
            tokenHash,
            replacedByTokenHash: null,
            revokedAt: null,
            deviceLabel: deviceLabel ?? null,
            expiresAt,
        });

        await this.refreshTokenRepository.save(entity);
        return { rawRefreshToken, familyId };
    }

    /**
     * Core rotation logic.
     *
     * Happy path   → marks old token as replaced, inserts new token in the same family.
     * Concurrent   → if old token was replaced within the grace window, returns the successor token.
     * Theft        → if old token was replaced outside the grace window, revokes the entire family.
     * Expired      → rejects with SESSION_EXPIRED.
     * Revoked      → rejects with SESSION_REVOKED.
     *
     * Returns the new raw token and the user context embedded in the token row so the
     * caller can issue a new access token without an extra users-table lookup.
     */
    async rotateRefreshToken(rawRefreshToken: string): Promise<RotationResult> {
        const incomingHash = this.hashToken(rawRefreshToken);

        // Use a transaction so the replace+insert is atomic
        return this.dataSource.transaction(async (manager) => {
            const repo = manager.getRepository(RefreshTokenEntity);

            const token = await repo.findOne({
                where: { tokenHash: incomingHash },
                relations: ['user'],
                lock: { mode: 'pessimistic_write' },
            });

            if (!token) {
                throw new UnauthorizedException({
                    code: 'SESSION_NOT_FOUND',
                    messageKey: 'errors.session.not_found',
                });
            }

            // ── Already revoked (sign-out or prior theft detection) ──
            if (token.revokedAt !== null) {
                throw new UnauthorizedException({
                    code: 'SESSION_REVOKED',
                    messageKey: 'errors.session.revoked',
                });
            }

            // ── Expired ──
            if (token.expiresAt < new Date()) {
                throw new UnauthorizedException({
                    code: 'SESSION_EXPIRED',
                    messageKey: 'errors.session.expired',
                });
            }

            // ── Already replaced (potential theft or concurrent refresh) ──
            if (token.replacedByTokenHash !== null) {
                const ageMs = Date.now() - token.createdAt.getTime();

                if (ageMs <= ROTATION_GRACE_MS) {
                    // Concurrent refresh within the grace window — find and return the successor
                    this.logger.warn(
                        `Concurrent refresh within grace window for family ${token.familyId}`,
                    );
                    const successor = await repo.findOne({
                        where: {
                            familyId: token.familyId,
                            tokenHash: token.replacedByTokenHash,
                        },
                    });

                    if (successor && successor.revokedAt === null) {
                        return {
                            rawRefreshToken, // client already has this — it's a no-op
                            familyId: token.familyId,
                            userId: token.user.id,
                            userStatus: token.user.status,
                            userEmail: token.user.email,
                        };
                    }
                }

                // Outside grace window → theft detected — revoke entire family
                this.logger.warn(
                    `Theft detected — revoking entire family ${token.familyId} for user ${token.userId}`,
                );
                await repo
                    .createQueryBuilder()
                    .update(RefreshTokenEntity)
                    .set({ revokedAt: new Date() })
                    .where('family_id = :familyId AND revoked_at IS NULL', {
                        familyId: token.familyId,
                    })
                    .execute();

                throw new UnauthorizedException({
                    code: 'SESSION_COMPROMISED',
                    messageKey: 'errors.session.compromised',
                });
            }

            // ── Happy path: rotate ──
            const newRaw = this.generateRawToken();
            const newHash = this.hashToken(newRaw);
            const newExpiresAt = this.expiresInDays(REFRESH_TOKEN_TTL_DAYS);

            // Mark old token as replaced
            token.replacedByTokenHash = newHash;
            await repo.save(token);

            // Insert new token in the same family
            const newToken = repo.create({
                familyId: token.familyId,
                userId: token.userId,
                tokenHash: newHash,
                replacedByTokenHash: null,
                revokedAt: null,
                deviceLabel: token.deviceLabel,
                expiresAt: newExpiresAt,
            });
            await repo.save(newToken);

            return {
                rawRefreshToken: newRaw,
                familyId: token.familyId,
                userId: token.user.id,
                userStatus: token.user.status,
                userEmail: token.user.email,
            };
        });
    }

    /**
     * Revokes every token in the given family (single session sign-out).
     * Returns false if the family was not found or already fully revoked.
     */
    async revokeSession(familyId: string): Promise<void> {
        await this.refreshTokenRepository
            .createQueryBuilder()
            .update(RefreshTokenEntity)
            .set({ revokedAt: new Date() })
            .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
            .execute();
    }

    /**
     * Revokes ALL refresh tokens for a user — used by sign-out-everywhere and password-reset.
     */
    async revokeAllSessionsForUser(userId: string): Promise<void> {
        await this.refreshTokenRepository
            .createQueryBuilder()
            .update(RefreshTokenEntity)
            .set({ revokedAt: new Date() })
            .where('user_id = :userId AND revoked_at IS NULL', { userId })
            .execute();
    }

    /**
     * Returns distinct active session families for the user (one row per device/login).
     * Used for "my sessions" display.
     */
    async findActiveSessionsForUser(
        userId: string,
    ): Promise<{ familyId: string; deviceLabel: string | null; createdAt: Date }[]> {
        const rows = await this.refreshTokenRepository
            .createQueryBuilder('rt')
            .select(['rt.family_id AS "familyId"', 'rt.device_label AS "deviceLabel"', 'MIN(rt.created_at) AS "createdAt"'])
            .where('rt.user_id = :userId', { userId })
            .andWhere('rt.revoked_at IS NULL')
            .andWhere('rt.expires_at > NOW()')
            .andWhere('rt.replaced_by_token_hash IS NULL')
            .groupBy('rt.family_id, rt.device_label')
            .getRawMany<{ familyId: string; deviceLabel: string | null; createdAt: Date }>();

        return rows;
    }
}