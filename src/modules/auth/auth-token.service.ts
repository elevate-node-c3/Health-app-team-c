import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import * as crypto from 'crypto';

@Injectable()
export class AuthTokenService {
    constructor(
        @InjectRepository(RefreshTokenEntity)
        private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    ) { }

    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    async saveRefreshToken(userId: string, token: string, expiresInDays: number = 7): Promise<void> {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);

        const hashedToken = this.hashToken(token);

        const refreshTokenEntity = this.refreshTokenRepository.create({
            userId,
            tokenHash: hashedToken,
            expiresAt,
        });

        await this.refreshTokenRepository.save(refreshTokenEntity);
    }
}