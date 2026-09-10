import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { AuthTokenService } from '../auth-token.service';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';
import { SignOutDto } from '../dto/sign-out.dto';

@Injectable()
export class SignOutUseCase {
    private readonly logger = new Logger(SignOutUseCase.name);

    constructor(
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepository: Repository<OutboxEventEntity>,
        @InjectRepository(RefreshTokenEntity)
        private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
        private readonly authTokenService: AuthTokenService,
        private readonly outboxProcessorService: OutboxProcessorService,
    ) {}

    /**
     * Signs out the current session only.
     * Requires the raw refresh token to identify the family — a stolen access token
     * alone cannot sign the real user out.
     */
    async signOut(dto: SignOutDto, requestingUserId: string): Promise<{ message: string }> {
        const tokenHash = crypto.createHash('sha256').update(dto.refreshToken).digest('hex');

        const token = await this.refreshTokenRepository.findOne({
            where: { tokenHash },
        });

        if (!token) {
            throw new UnauthorizedException({
                code: 'SESSION_NOT_FOUND',
                messageKey: 'errors.session.not_found',
            });
        }

        // Ownership check — the token must belong to the requesting user
        if (token.userId !== requestingUserId) {
            throw new UnauthorizedException({
                code: 'SESSION_NOT_FOUND',
                messageKey: 'errors.session.not_found',
            });
        }

        await this.authTokenService.revokeSession(token.familyId);
        await this.publishSessionEndedEvent(token.userId, token.familyId, 'user_signout');

        return { message: 'Signed out successfully.' };
    }

    /**
     * Signs out every active session for the user.
     * Used when the user wants to kick all other devices.
     */
    async signOutEverywhere(userId: string): Promise<{ message: string }> {
        // Collect active family IDs before revoking so we can publish one event per session
        const activeSessions = await this.authTokenService.findActiveSessionsForUser(userId);

        await this.authTokenService.revokeAllSessionsForUser(userId);

        for (const session of activeSessions) {
            await this.publishSessionEndedEvent(userId, session.familyId, 'signout_everywhere');
        }

        return { message: `Signed out from ${activeSessions.length} session(s).` };
    }

    private async publishSessionEndedEvent(
        userId: string,
        familyId: string,
        reason: 'user_signout' | 'signout_everywhere' | 'password_reset',
    ): Promise<void> {
        try {
            const outboxEvent = this.outboxRepository.create({
                aggregateType: 'SESSION',
                eventType: 'session.ended',
                payload: {
                    userId,
                    familyId,
                    endedAt: new Date().toISOString(),
                    reason,
                },
                isProcessed: false,
            });
            const saved = await this.outboxRepository.save(outboxEvent);
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(saved.id).catch((err) => {
                    this.logger.error(`Outbox publish failed for session.ended: ${err.message}`);
                });
            });
        } catch (err) {
            this.logger.error(`Failed to write session.ended to outbox: ${err.message}`);
        }
    }
}
