import { Test } from '@nestjs/testing';
import type { DynamicModule } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import type { StudentService } from '../student/student.service';
import type { SecretaryService } from '../secretary/secretary.service';
import type { HashContentService } from '../utils/hashContentService';
import type { MailService } from '../utils/mailService';
import type { VerificationService } from '../verification/verification.service';

const TTL = 30 * 24 * 60 * 60;

describe('Production login session lifetime', () => {
  it('student, secretary and code login expire exactly after 30 days; recovery keeps its own deadline', async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    // Load the real JWT module configured by AuthModule without initializing database/mail providers.
    const imports = Reflect.getMetadata(
      'imports',
      AuthModule,
    ) as DynamicModule[];
    const module = await Test.createTestingModule({
      imports: [imports[0]],
    }).compile();
    try {
      const jwt = module.get(JwtService);
      const student = {
        ra: '123',
        accountId: 'account-id',
        email: 'student@example.test',
        password: 'hash',
        lastLogin: new Date(),
        name: 'Student',
      };
      const service = new AuthService(
        {
          getStudentByEmail: jest.fn().mockResolvedValue(student),
          updateLastLoginStudent: jest.fn(),
        } as unknown as StudentService,
        {
          getSecretaryByEmail: jest.fn().mockResolvedValue({
            id: 1,
            password: 'hash',
            dueDate: new Date(Date.now() + 365 * 86400000),
            lastLogin: new Date(),
          }),
          updateLastLogin: jest.fn(),
        } as unknown as SecretaryService,
        jwt,
        {
          compareHash: jest.fn().mockResolvedValue(true),
        } as unknown as HashContentService,
        {} as MailService,
        {
          verifyCode: jest.fn().mockResolvedValue(true),
        } as unknown as VerificationService,
      );
      const tokens = [
        (await service.signInStudent(student.email, 'test')).accessToken,
        (await service.signInSecretary('secretary@example.test', 'test'))
          .accessToken,
        (await service.verifyCodeAndLogin(student.email, 'test')).access_token,
      ];
      for (const token of tokens) {
        const payload = await jwt.verifyAsync<{ iat: number; exp: number }>(
          token,
        );
        expect(payload.exp - payload.iat).toBe(TTL);
        await expect(
          jwt.verifyAsync(token, { clockTimestamp: payload.exp - 1 }),
        ).resolves.toBeDefined();
        await expect(
          jwt.verifyAsync(token, { clockTimestamp: payload.exp }),
        ).rejects.toThrow();
      }
      const recovery = await jwt.signAsync(
        { sub: 'recovery-test' },
        { expiresIn: '15h' },
      );
      const claims = await jwt.verifyAsync<{ iat: number; exp: number }>(
        recovery,
      );
      expect(claims.exp - claims.iat).toBe(15 * 3600);
    } finally {
      await module.close();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });
});
