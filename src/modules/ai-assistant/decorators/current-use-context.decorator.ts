import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserContext } from 'src/common/middleware/auth-context.middleware';


export const CurrentUserContext = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): UserContext => {
        return ctx.switchToHttp().getRequest().userContext;
    },
);