import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

export interface AccessTokenPayload {
    /** Subject — the user's UUID. */
    sub: string;
    email: string;
    /** Maps 1:1 to UserStatus enum values. */
    status: string;
    /** JWT ID — unique per issued token, used for log traceability. */
    jti: string;
    /** The refresh-token family this access token belongs to. Carried so sign-out needs no extra DB lookup. */
    familyId: string;
    fullName: string;
}

@Injectable()
export class TokenUtils {
    constructor(private readonly jwtService: JwtService) { }

    /**
     * Generates a cryptographically random 256-bit opaque token suitable for use
     * as a raw refresh token. The raw value is passed to the caller; a hash of it
     * is stored in the database — the raw value is never persisted.
     */
    generateSecureToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Issues a short-lived access token (15 min) embedding the user's status,
     * a unique jti, and the token-family ID for session management.
     */
    generateAccessToken(payload: Omit<AccessTokenPayload, 'jti'>): string {
        const accessSecret = process.env.JWT_ACCESS_SECRET;
        if (!accessSecret) {
            throw new Error('JWT_ACCESS_SECRET is not defined in environment variables.');
        }

        const jti = crypto.randomUUID();

        return this.jwtService.sign(
            { ...payload, jti },
            { secret: accessSecret, expiresIn: '15m' },
        );
    }

    /**
     * @deprecated Use generateAccessToken() + AuthTokenService.issueTokenFamily() separately.
     * Kept for backwards-compatibility with verify-email use case until it is patched.
     */
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

        return { accessToken, refreshToken };
    }

    verifyToken(token: string, secret: string): AccessTokenPayload {
        try {
            return this.jwtService.verify(token, { secret });
        } catch {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
