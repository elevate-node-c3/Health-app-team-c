import {
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { RedisService } from 'src/common/redis/redis.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

const GUEST_DAILY_LIMIT = 10;
const USER_DAILY_LIMIT = 50;

export const AI_COST_LIMITS = {
    MAX_TOKENS_PER_MESSAGE: 2000,
    MONTHLY_SPEND_CEILING_USD: 500,
    MAX_PATIENT_MONTHLY_SPEND_USD: 50,
    ALERT_THRESHOLDS: [0.60, 0.80, 1.00],
};

@Injectable()
export class AiQuotaService {
    private readonly logger = new Logger(AiQuotaService.name);

    constructor(
        private readonly redisService: RedisService,
        private readonly amqpConnection: AmqpConnection,
    ) { }

    async consume(userContext: UserContext): Promise<void> {
        const isGuest = userContext.role === 'GUEST' || !userContext.userId;
        const identifierId = isGuest ? userContext.deviceId : userContext.userId;

        if (!identifierId) {
            throw new HttpException(
                { code: 'AUTH_IDENTITY_MISSING', messageKey: 'errors.auth.identity_missing' },
                HttpStatus.FORBIDDEN,
            );
        }

        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7);

        if (!isGuest && userContext.userId) {
            const patientSpendKey = `ai_spend:patient:${userContext.userId}:${currentMonth}`;
            const patientSpend = await this.redisService.get<number>(patientSpendKey);

            if (patientSpend && patientSpend >= AI_COST_LIMITS.MAX_PATIENT_MONTHLY_SPEND_USD) {
                throw new HttpException(
                    {
                        code: 'AI_PATIENT_SPEND_LIMIT_EXCEEDED',
                        messageKey: 'errors.ai.patient_spend_limit_reached',
                        message: 'You have reached your individual monthly allowance for AI interactions.',
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }

        const limit = isGuest ? GUEST_DAILY_LIMIT : USER_DAILY_LIMIT;
        const today = now.toISOString().split('T')[0];
        const key = `ai_limit:${isGuest ? 'guest' : 'user'}:${identifierId}:${today}`;

        try {
            await this.redisService.setNx(key, '0', this.secondsUntilUtcMidnight(now) + 60);
            const count = await this.redisService.incr(key);

            if (count > limit) {
                await this.amqpConnection.publish('ai_exchange', 'AI_USAGE_LIMIT_REACHED', {
                    identifierId,
                    patientId: isGuest ? null : identifierId,
                    deviceId: isGuest ? identifierId : null,
                    isGuest,
                    limit,
                    reachedAt: now.toISOString(),
                }).catch((err) => {
                    this.logger.error(`Failed to publish AI_USAGE_LIMIT_REACHED event: ${err.message}`);
                });

                throw new HttpException(
                    {
                        code: 'AI_RATE_LIMIT_EXCEEDED',
                        messageKey: isGuest
                            ? 'errors.ai.guest_limit_reached'
                            : 'errors.ai.user_limit_reached',
                        message: isGuest
                            ? 'You have reached your daily limit of 10 messages as a guest. Please sign in for 50 daily messages.'
                            : 'You have reached your daily limit of 50 AI messages.',
                        details: {
                            limit,
                            resetAt: this.getUtcMidnightIsoString(now),
                            canUpgradeRole: isGuest,
                        },
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        } catch (error) {
            if (error instanceof HttpException) throw error;

            this.logger.error(`AI quota check failed: ${(error as Error).message}`);
            throw new ServiceUnavailableException({
                code: 'AI_TEMPORARILY_UNAVAILABLE',
                messageKey: 'errors.ai.unavailable',
            });
        }
    }

    private secondsUntilUtcMidnight(now: Date): number {
        const end = new Date(now);
        end.setUTCHours(23, 59, 59, 999);
        return Math.max(1, Math.floor((end.getTime() - now.getTime()) / 1000));
    }

    private getUtcMidnightIsoString(now: Date): string {
        const end = new Date(now);
        end.setUTCHours(23, 59, 59, 999);
        return end.toISOString();
    }
}