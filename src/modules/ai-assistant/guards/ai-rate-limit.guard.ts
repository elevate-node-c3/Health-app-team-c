import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    HttpStatus,
    HttpException,
    Logger,
} from '@nestjs/common';
import { UserContext } from 'src/common/middleware/auth-context.middleware';
import { RedisService } from 'src/common/redis/redis.service';
import { EmergencyDetectorService } from '../services/emergency-detector.service';

@Injectable()
export class AiRateLimitGuard implements CanActivate {
    private readonly logger = new Logger(AiRateLimitGuard.name);

    constructor(
        private readonly redisService: RedisService,
        private readonly emergencyDetector: EmergencyDetectorService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const userContext: UserContext = request.userContext;

        if (!userContext) {
            throw new ForbiddenException({
                code: 'AUTH_IDENTITY_MISSING',
                messageKey: 'errors.auth.identity_missing',
            });
        }

        const body = request.body?.message;
        if (typeof body === 'string' && this.emergencyDetector.detectEmergency(body).isEmergency) {
            return true;
        }

        const isGuest = userContext.role === 'GUEST';
        const identifierId = isGuest ? userContext.deviceId : userContext.userId;

        if (!identifierId) {
            throw new ForbiddenException({
                code: 'AUTH_IDENTITY_MISSING',
                messageKey: 'errors.auth.identity_missing',
            });
        }

        const identifier = isGuest ? `guest:${identifierId}` : `user:${identifierId}`;
        const limit = isGuest ? 10 : 50;

        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const redisKey = `ai_limit:${identifier}:${today}`;

        try {
            const currentCount = await this.redisService.incr(redisKey);

            if (currentCount === 1) {
                const secondsUntilMidnight = this.getSecondsUntilMidnight(now);
                await this.redisService.expire(redisKey, secondsUntilMidnight);
            }

            if (currentCount > limit) {
                throw new HttpException(
                    {
                        code: 'AI_RATE_LIMIT_EXCEEDED',
                        message: isGuest
                            ? 'You have reached your daily limit of 10 messages as a guest. Please sign in for 50 daily messages.'
                            : 'You have reached your daily limit of 50 AI messages.',
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }

            return true;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(
                `Failed to process AI Rate Limit in Redis for ${identifier}: ${error.message}`,
                error.stack,
            );
            return true;
        }
    }

    private getSecondsUntilMidnight(now: Date): number {
        const endOfDay = new Date(now);
        endOfDay.setUTCHours(23, 59, 59, 999);
        return Math.max(1, Math.floor((endOfDay.getTime() - now.getTime()) / 1000));
    }
}