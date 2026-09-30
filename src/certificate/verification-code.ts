import * as crypto from 'crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_REGEX = /^FATEC-EVT-[0-9A-HJKMNP-TV-Z]{16}$/;

/**
 * Gera um código de verificação institucional de 80 bits de entropia (16 caracteres base32).
 * Formato canônico: FATEC-EVT-XXXXXXXXXXXXXXXX
 */
export function generateVerificationCode(): string {
  const bytes = crypto.randomBytes(10); // 80 bits
  let bigInt = 0n;
  for (let i = 0; i < 10; i++) {
    bigInt = (bigInt << 8n) | BigInt(bytes[i]);
  }

  let code = '';
  for (let i = 0; i < 16; i++) {
    const shift = BigInt((15 - i) * 5);
    const index = Number((bigInt >> shift) & 31n);
    code += ALPHABET[index];
  }

  return `FATEC-EVT-${code}`;
}

export function isValidVerificationCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  return CODE_REGEX.test(code.trim().toUpperCase());
}

export function normalizeVerificationCode(code: string): string {
  return code.trim().toUpperCase();
}
