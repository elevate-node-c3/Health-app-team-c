import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class TokenUtils {
    constructor(private readonly jwtService: JwtService) { }

    generateTokens(payload: { sub: string; email: string; status: string }) {
        const accessSecret = process.env.JWT_ACCESS_SECRET;
        const refreshSecret = process.env.JWT_REFRESH_SECRET;

        if (!accessSecret || !refreshSecret) {
            throw new Error('JWT secrets are not defined in environment variables.');
        }

        const accessToken = this.jwtService.sign(payload, {
            secret: accessSecret,
            expiresIn: '15m',
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: refreshSecret,
            expiresIn: '7d',
        });

        return {
            accessToken,
            refreshToken,
        };
    }

    verifyToken(token: string, secret: string): any {
        try {
            return this.jwtService.verify(token, { secret });
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}