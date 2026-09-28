export interface AuthSecrets {
  jwtSecret: string;
  attendanceQrSecret: string;
}

export function loadAuthSecrets(
  env: NodeJS.ProcessEnv = process.env,
): AuthSecrets {
  const missing = ['JWT_SECRET', 'ATTENDANCE_QR_SECRET'].filter(
    (key) => !env[key]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required authentication environment variable(s): ${missing.join(', ')}`,
    );
  }

  return {
    jwtSecret: env.JWT_SECRET!.trim(),
    attendanceQrSecret: env.ATTENDANCE_QR_SECRET!.trim(),
  };
}
