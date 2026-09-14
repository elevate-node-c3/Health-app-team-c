import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { CACHE_KEYS_METADATA } from '../decorators/evict-cache.decorator';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CacheEvictionInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        private readonly redisService: RedisService,
    ) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const keysToEvict = this.reflector.getAllAndOverride<string[]>(
            CACHE_KEYS_METADATA,
            [context.getHandler(), context.getClass()],
        );

        return next.handle().pipe(
            tap(async () => {
                if (keysToEvict && keysToEvict.length > 0) {
                    for (const key of keysToEvict) {
                        await this.redisService.del(key);
                    }
                }
            }),
        );
    }
}