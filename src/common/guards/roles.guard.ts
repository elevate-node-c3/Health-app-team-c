import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserContext, Role } from '../middleware/auth-context.middleware';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.get<Role[]>('roles', context.getHandler());


        if (!requiredRoles) {
            throw new ForbiddenException({
                code: 'AUTH_DENIED_BY_DEFAULT',
                messageKey: 'errors.auth.denied_by_default',
            });
        }

        const request = context.switchToHttp().getRequest();
        const userContext: UserContext = request.userContext;

        if (!userContext) {
            throw new ForbiddenException({
                code: 'AUTH_IDENTITY_MISSING',
                messageKey: 'errors.auth.identity_missing',
            });
        }

        const hasRole = requiredRoles.includes(userContext.role);

        if (hasRole) {
            return true;
        }

        if (userContext.role === 'GUEST') {
            throw new ForbiddenException({
                code: 'AUTH_REQUIRED',
                messageKey: 'errors.auth.login_required',
            });
        }

        if (userContext.role === 'UNVERIFIED_PATIENT') {
            throw new ForbiddenException({
                code: 'PHONE_VERIFICATION_REQUIRED',
                messageKey: 'errors.auth.phone_verification_required',
            });
        }

        throw new ForbiddenException({
            code: 'AUTH_FORBIDDEN',
            messageKey: 'errors.auth.access_denied',
        });
    }
}