import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { RefreshTokenDto } from '../dto/refresh-token.dto';

@Injectable()
export class RefreshTokenUseCase {
    private readonly logger = new Logger(RefreshTokenUseCase.name);

    constructor(
        @InjectRepository(OutboxEventEntity)
        private readonly outboxRepository: Repository<OutboxEventEntity>,
        private readonly tokenUtils: TokenUtils,
        private readonly authTokenService: AuthTokenService,
        private readonly dataSource: DataSource,
        private readonly outboxProcessorService: OutboxProcessorService,
    ) {}

    async execute(dto: RefreshTokenDto) {
        // rotateRefreshToken handles all cases:
        //   happy path  → returns new raw token + user context
        //   theft       → revokes entire family and throws SESSION_COMPROMISED
        //   expired     → throws SESSION_EXPIRED
        //   revoked     → throws SESSION_REVOKED
        const rotation = await this.authTokenService.rotateRefreshToken(dto.refreshToken);

        // If theft was detected, rotateRefreshToken already threw; publish the event here
        // for the happy path only. Theft event is published separately in the catch block
        // of the controller (or via a global exception filter listening to SESSION_COMPROMISED).
        // For now we publish session.created-equivalent (a "token refreshed" event is not
        // required by the story; session.created already fired at login).

        // Issue a new access token
        const accessToken = this.tokenUtils.generateAccessToken({
            sub: rotation.userId,
            email: rotation.userEmail,
            status: rotation.userStatus,
            familyId: rotation.familyId,
        });

        return {
            message: 'Token refreshed successfully.',
            data: {
                accessToken,
                refreshToken: rotation.rawRefreshToken,
                expiresIn: 900,
            },
        };
    }

    /**
     * Called by the controller's theft-detection catch path to publish a domain event
     * when SESSION_COMPROMISED is detected during rotation.
     */
    async publishTheftEvent(userId: string, familyId: string): Promise<void> {
        try {
            const outboxEvent = this.outboxRepository.create({
                aggregateType: 'SESSION',
                eventType: 'session.theft_detected',
                payload: {
                    userId,
                    familyId,
                    detectedAt: new Date().toISOString(),
                },
                isProcessed: false,
            });
            const saved = await this.outboxRepository.save(outboxEvent);
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(saved.id).catch((err) => {
                    this.logger.error(`Outbox publish failed for session.theft_detected: ${err.message}`);
                });
            });
        } catch (err) {
            this.logger.error(`Failed to write session.theft_detected to outbox: ${err.message}`);
        }
    }
}
