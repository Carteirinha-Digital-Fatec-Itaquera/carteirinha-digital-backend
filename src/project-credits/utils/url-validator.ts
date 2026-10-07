import { BadRequestException } from '@nestjs/common';
import { ProjectCreditContactKind } from '../project-credits.types';

export const SEMESTER_REGEX = /^\d{4}\.[12]$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSemester(semester: string): string {
  const trimmed = semester?.trim();
  if (!trimmed || !SEMESTER_REGEX.test(trimmed)) {
    throw new BadRequestException(
      `Semestre inválido: "${semester}". Deve estar no formato YYYY.1 ou YYYY.2.`,
    );
  }
  return trimmed;
}

export function normalizeAndValidateUrl(
  kind: ProjectCreditContactKind,
  rawUrl: string,
  rawLabel: string,
): { url: string; label: string; kind: ProjectCreditContactKind } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new BadRequestException('A URL do link é obrigatória.');
  }

  const trimmedUrl = rawUrl.trim();
  const trimmedLabel = rawLabel?.trim() || '';

  if (/[\r\n]/.test(trimmedUrl) || /[\r\n]/.test(trimmedLabel)) {
    throw new BadRequestException('Links não podem conter quebras de linha.');
  }

  if (trimmedUrl.length > 2048) {
    throw new BadRequestException('A URL não pode exceder 2.048 caracteres.');
  }

  if (trimmedLabel.length > 60) {
    throw new BadRequestException('O rótulo do link não pode exceder 60 caracteres.');
  }

  if (kind === 'email') {
    let cleanEmail = trimmedUrl;
    if (cleanEmail.toLowerCase().startsWith('mailto:')) {
      cleanEmail = cleanEmail.slice(7);
    }
    if (!EMAIL_REGEX.test(cleanEmail)) {
      throw new BadRequestException(`E-mail inválido para contato: "${trimmedUrl}".`);
    }
    return {
      kind: 'email',
      url: `mailto:${cleanEmail}`,
      label: trimmedLabel || 'E-mail',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    throw new BadRequestException(`Formato de URL inválido: "${trimmedUrl}".`);
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException(
      `Apenas URLs seguras (HTTPS) são permitidas: "${trimmedUrl}".`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException('URLs não podem conter credenciais embutidas.');
  }

  const defaultLabels: Record<ProjectCreditContactKind, string> = {
    github: 'GitHub',
    linkedin: 'LinkedIn',
    portfolio: 'Portfólio',
    email: 'E-mail',
    external: 'Link',
  };

  return {
    kind,
    url: parsed.toString(),
    label: trimmedLabel || defaultLabels[kind] || 'Link',
  };
}
