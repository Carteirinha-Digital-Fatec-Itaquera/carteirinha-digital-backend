import { createHmac } from 'crypto';

export interface AuthSecrets {
  jwtSecret: string;
  attendanceQrSecret: string;
}

export function loadAuthSecrets(
  env: NodeJS.ProcessEnv = process.env,
): AuthSecrets {
  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error(
      'Missing required authentication environment variable(s): JWT_SECRET',
    );
  }

  const envQrSecret = env.ATTENDANCE_QR_SECRET?.trim();
  const attendanceQrSecret =
    envQrSecret && envQrSecret !== jwtSecret
      ? envQrSecret
      : createHmac('sha256', jwtSecret)
          .update('fatec-attendance-qr-secret-salt-2026')
          .digest('hex');

  return {
    jwtSecret,
    attendanceQrSecret,
  };
}
