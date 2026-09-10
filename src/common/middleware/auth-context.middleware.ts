import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TokenUtils } from 'src/common/utils/token.utils';

export type Role = 'GUEST' | 'UNVERIFIED_PATIENT' | 'PATIENT' | 'DOCTOR' | 'ADMIN';

export interface UserContext {
    role: Role;
    userId?: string;
    deviceId?: string;
    /** The refresh-token family this session belongs to. Carried from the access JWT. */
    familyId?: string;
}

declare global {
    namespace Express {
        interface Request {
            userContext?: UserContext;
        }
    }
}

@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
    constructor(private readonly tokenUtils: TokenUtils) {}

    async use(req: Request, res: Response, next: NextFunction) {

        const publicPaths = [
            '/api/v1/auth/signup',
            '/api/v1/auth/verify-email',
            '/api/v1/auth/resend-otp',
            '/api/v1/auth/signin',
            '/api/v1/auth/refresh',
        ];

        if (publicPaths.some((path) => req.originalUrl.includes(path))) {
            return next();
        }

        const authHeader = req.headers.authorization;
        const deviceId = req.headers['x-device-id'] as string;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const secret = process.env.JWT_ACCESS_SECRET || 'access_secret_key';
                const payload = this.tokenUtils.verifyToken(token, secret);

                req.userContext = {
                    role: (payload.status as Role) || 'UNVERIFIED_PATIENT',
                    userId: payload.sub,
                    deviceId: deviceId || undefined,
                    familyId: payload.familyId,
                };

                return next();
            } catch (err) {
                throw new UnauthorizedException({
                    errorCode: 'AUTH_INVALID_TOKEN',
                    messageKey: 'errors.auth.invalid_token',
                });
            }
        }

        if (deviceId) {
            req.userContext = {
                role: 'GUEST',
                deviceId,
            };
            return next();
        }

        throw new UnauthorizedException({
            errorCode: 'AUTH_IDENTITY_MISSING',
            message: 'Authentication identity (Bearer token or x-device-id) is missing.',
        });
    }
}