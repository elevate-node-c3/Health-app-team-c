import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard (CAT-7)', () => {
  let guard: RolesGuard;
  let reflector: any;

  const favoriteRoles = ['UNVERIFIED_PATIENT', 'PATIENT', 'DOCTOR', 'ADMIN'];

  function mockContext(role?: string) {
    return {
      getHandler: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => (role ? { userContext: { role } } : {}),
      }),
    } as any;
  }

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(favoriteRoles) };
    guard = new RolesGuard(reflector as Reflector);
  });

  it('refuses guests on favourite routes with AUTH_REQUIRED', () => {
    try {
      guard.canActivate(mockContext('GUEST'));
      fail('expected ForbiddenException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(JSON.stringify(err.getResponse())).toContain('AUTH_REQUIRED');
    }
  });

  it('allows signed-in roles on favourite routes', () => {
    for (const role of favoriteRoles) {
      expect(guard.canActivate(mockContext(role))).toBe(true);
    }
  });

  it('refuses missing identity', () => {
    try {
      guard.canActivate(mockContext(undefined));
      fail('expected ForbiddenException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(JSON.stringify(err.getResponse())).toContain('AUTH_IDENTITY_MISSING');
    }
  });
});
