import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contextFor(role?: 'student' | 'secretary'): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  beforeEach(() => jest.clearAllMocks());

  it('allows routes without role metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor('student'))).toBe(true);
  });

  it('allows the required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['secretary']);
    expect(guard.canActivate(contextFor('secretary'))).toBe(true);
  });
  it.each([
    ['secretary', 'student'],
    ['student', 'secretary'],
  ] as const)('rejects %s route for %s role', (required, actual) => {
    reflector.getAllAndOverride.mockReturnValue([required]);
    expect(() => guard.canActivate(contextFor(actual))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a protected route without an authenticated user', () => {
    reflector.getAllAndOverride.mockReturnValue(['student']);
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
