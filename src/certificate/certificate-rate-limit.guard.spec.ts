/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { HttpException, HttpStatus } from '@nestjs/common';
import { CertificateRateLimitGuard } from './certificate-rate-limit.guard';
import { certificateRateLimitStorage } from './certificate-rate-limit.storage';

describe('CertificateRateLimitGuard', () => {
  let guard: CertificateRateLimitGuard;

  beforeEach(() => {
    guard = new CertificateRateLimitGuard();
    certificateRateLimitStorage.reset();
  });

  function createMockContext(ip: string, code?: string) {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: jest.fn((k: string, v: string) => {
        headers[k] = v;
      }),
    };
    const req = {
      ip,
      params: { code },
      socket: { remoteAddress: ip },
    };

    return {
      context: {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
      } as any,
      res,
      headers,
    };
  }

  it('allows requests within the 60/min IP limit', () => {
    const { context } = createMockContext(
      '192.168.1.1',
      'FATEC-EVT-0123456789ABCDEF',
    );
    for (let i = 0; i < 60; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('blocks the 61st request from the same IP with 429 and Retry-After header', () => {
    const { context, headers } = createMockContext(
      '192.168.1.2',
      'FATEC-EVT-0123456789ABCDEF',
    );
    for (let i = 0; i < 60; i++) {
      guard.canActivate(context);
    }

    try {
      guard.canActivate(context);
      fail('Deveria ter lançado HttpException 429');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(headers['Retry-After']).toBeDefined();
    }
  });

  it('blocks when code rate limit exceeds 300/min across different IPs', () => {
    const targetCode = 'FATEC-EVT-COMMON0000000000';
    for (let i = 0; i < 300; i++) {
      // Diferentes IPs para não estourar o limite de IP (60)
      const ip = `10.0.${Math.floor(i / 50)}.${i % 50}`;
      const { context } = createMockContext(ip, targetCode);
      expect(guard.canActivate(context)).toBe(true);
    }

    // 301ª tentativa no mesmo código
    const { context } = createMockContext('10.0.99.99', targetCode);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });
});
