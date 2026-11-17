import { InternalServerErrorException } from '@nestjs/common';

export function buildPasswordRecoveryUrl(
  profile: 'student' | 'secretary',
  token: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base =
    profile === 'student'
      ? env.STUDENT_APP_URL?.trim() ||
        'https://carteirinha-digital-front-end-aluno.vercel.app'
      : env.SECRETARY_APP_URL?.trim() ||
        env.FRONTEND_URL?.trim() ||
        'http://localhost:5173';
  try {
    const url = new URL('/reset-password', base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid frontend URL');
    url.search = new URLSearchParams({ token, id, type: profile }).toString();
    return url.toString();
  } catch {
    throw new InternalServerErrorException(
      'Endereço de recuperação de senha indisponível.',
    );
  }
}

export function buildEmployeeActionUrl(
  purpose: 'ACTIVATE' | 'RESET_PASSWORD',
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = env.EMPLOYEE_APP_URL?.trim();
  if (!base) {
    throw new InternalServerErrorException(
      'EMPLOYEE_APP_URL deve estar configurada para links de acesso de funcionários.',
    );
  }
  try {
    const path =
      purpose === 'ACTIVATE' ? '/ativar-acesso' : '/redefinir-senha';
    const url = new URL(path, base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('Invalid employee frontend URL');
    }
    url.search = new URLSearchParams({ token }).toString();
    return url.toString();
  } catch {
    throw new InternalServerErrorException(
      'Endereço de acesso de funcionários indisponível.',
    );
  }
}
