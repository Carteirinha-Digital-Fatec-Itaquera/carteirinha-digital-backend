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

  const attendanceQrSecret = env.ATTENDANCE_QR_SECRET?.trim();
  if (!attendanceQrSecret || attendanceQrSecret === jwtSecret) {
    throw new Error(
      'ATTENDANCE_QR_SECRET must be configured and distinct from JWT_SECRET',
    );
  }

  return {
    jwtSecret,
    attendanceQrSecret,
  };
}
