import { loadAuthSecrets } from './auth.config';

describe('loadAuthSecrets', () => {
  it('requires JWT_SECRET', () => {
    expect(() => loadAuthSecrets({})).toThrow('JWT_SECRET');
  });

  it('requires an independent QR secret', () => {
    for (const value of [undefined, '', 'login-secret']) {
      expect(() =>
        loadAuthSecrets({
          JWT_SECRET: 'login-secret',
          ATTENDANCE_QR_SECRET: value,
        }),
      ).toThrow('ATTENDANCE_QR_SECRET');
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
