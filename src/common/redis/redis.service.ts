import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis.Redis;

    onModuleInit() {
        const RedisClient = (Redis as any).default || Redis;
        this.client = new RedisClient({
            host: process.env.REDIS_HOST || 'localhost',
            port: Number(process.env.REDIS_PORT) || 6379,
        });
    }

    onModuleDestroy() {
        if (this.client) {
            this.client.quit();
        }
    }

    async set(key: string, value: any, ttlSeconds: number = 600): Promise<void> {
        await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }

    async get<T>(key: string): Promise<T | null> {
        const data = await this.client.get(key);
        if (!data) return null;
        return JSON.parse(data) as T;
    }

    async del(key: string): Promise<void> {
        await this.client.del(key);
    }

    async delPattern(pattern: string): Promise<void> {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
            await this.client.del(...keys);
        }
    }
}