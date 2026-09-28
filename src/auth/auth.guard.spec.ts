import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';

function contextFor(request: Record<string, any>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const jwtService = {
    verifyAsync: jest.fn(),
  };
  const guard = new AuthGuard(jwtService as unknown as JwtService);

  beforeEach(() => jest.clearAllMocks());

  it('returns 401 semantics when bearer token is missing', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('does not accept legacy token from request body', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: {}, body: { token: 'legacy' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects invalid or expired JWT', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer invalid' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects student JWT without immutable accountId', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: '000123',
      role: 'student',
    });
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer legacy-student' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts and attaches a valid student identity', async () => {
    const request = {
      headers: { authorization: 'Bearer student-token' },
    } as Record<string, any>;
    const payload = {
      sub: '000123',
      role: 'student',
      accountId: 'account-uuid',
    };
    jwtService.verifyAsync.mockResolvedValue(payload);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });

  it('accepts a valid secretary identity', async () => {
    const request = {
      headers: { authorization: 'Bearer secretary-token' },
    } as Record<string, any>;
    jwtService.verifyAsync.mockResolvedValue({
      sub: 42,
      role: 'secretary',
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({ sub: 42, role: 'secretary' });
  });
});
