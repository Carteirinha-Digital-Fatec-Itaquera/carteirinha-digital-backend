import { loadAuthSecrets } from './auth.config';

describe('loadAuthSecrets', () => {
  it('requires JWT_SECRET', () => {
    expect(() => loadAuthSecrets({})).toThrow('JWT_SECRET');
  });

  it('generates a distinct QR secret when ATTENDANCE_QR_SECRET is missing or equals JWT_SECRET', () => {
    for (const value of [undefined, '', 'login-secret']) {
      const secrets = loadAuthSecrets({
        JWT_SECRET: 'login-secret',
        ATTENDANCE_QR_SECRET: value,
      });
      expect(secrets.attendanceQrSecret).toBeDefined();
      expect(secrets.attendanceQrSecret).not.toBe('login-secret');
      expect(secrets.attendanceQrSecret.length).toBeGreaterThanOrEqual(32);
    }
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
