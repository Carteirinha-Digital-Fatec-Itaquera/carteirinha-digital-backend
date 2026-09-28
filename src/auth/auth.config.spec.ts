import { loadAuthSecrets } from './auth.config';

describe('loadAuthSecrets', () => {
  it('requires JWT_SECRET and ATTENDANCE_QR_SECRET', () => {
    expect(() => loadAuthSecrets({})).toThrow(
      'JWT_SECRET, ATTENDANCE_QR_SECRET',
    );
  });

  it('returns distinct configured secrets', () => {
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
