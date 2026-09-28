import { loadAuthSecrets } from './auth.config';

describe('loadAuthSecrets', () => {
  it('requires JWT_SECRET', () => {
    expect(() => loadAuthSecrets({})).toThrow('JWT_SECRET');
  });

  it('falls back attendanceQrSecret to JWT_SECRET if ATTENDANCE_QR_SECRET is missing', () => {
    expect(
      loadAuthSecrets({
        JWT_SECRET: 'login-secret',
      }),
    ).toEqual({
      jwtSecret: 'login-secret',
      attendanceQrSecret: 'login-secret',
    });
  });

  it('returns distinct configured secrets when both are provided', () => {
    expect(
      loadAuthSecrets({
        JWT_SECRET: 'login-secret',
        ATTENDANCE_QR_SECRET: 'attendance-secret',
      }),
    ).toEqual({
      jwtSecret: 'login-secret',
      attendanceQrSecret: 'attendance-secret',
    });
  });
});
