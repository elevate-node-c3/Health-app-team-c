import { SetMetadata } from '@nestjs/common';
import { Role } from '../middleware/auth-context.middleware';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);