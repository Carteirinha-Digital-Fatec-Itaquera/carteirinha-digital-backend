import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { certificateRateLimitStorage } from './certificate-rate-limit.storage';
import { normalizeVerificationCode } from './verification-code';

@Injectable()
export class CertificateRateLimitGuard implements CanActivate {
  private static readonly IP_LIMIT = 60;
  private static readonly CODE_LIMIT = 300;
  private static readonly WINDOW_MS = 60000;

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const codeParam = req.params?.code;

    // 1. Limite por IP (60 / min)
    const ipCheck = certificateRateLimitStorage.checkAndIncrement(
      `ip:${ip}`,
      CertificateRateLimitGuard.IP_LIMIT,
      CertificateRateLimitGuard.WINDOW_MS,
    );

    if (!ipCheck.allowed) {
      if (res && typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
      }
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message:
            'Limite de requisições por IP excedido. Tente novamente mais tarde.',
          code: 'RATE_LIMIT_EXCEEDED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Limite por código normalizado (300 / min)
    if (codeParam && typeof codeParam === 'string') {
      const normalized = normalizeVerificationCode(codeParam);
      const codeCheck = certificateRateLimitStorage.checkAndIncrement(
        `code:${normalized}`,
        CertificateRateLimitGuard.CODE_LIMIT,
        CertificateRateLimitGuard.WINDOW_MS,
      );

      if (!codeCheck.allowed) {
        if (res && typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', String(codeCheck.retryAfterSeconds));
        }
        throw new HttpException(
          {
            statusCode: 429,
            error: 'Too Many Requests',
            message:
              'Limite de requisições por código excedido. Tente novamente mais tarde.',
            code: 'RATE_LIMIT_EXCEEDED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}
