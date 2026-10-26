import { AuthService } from './auth.service';
import type { StudentService } from '../student/student.service';
import type { SecretaryService } from '../secretary/secretary.service';
import type { JwtService } from '@nestjs/jwt';
import type { HashContentService } from '../utils/hashContentService';
import type { MailService } from '../utils/mailService';
import type { VerificationService } from '../verification/verification.service';

describe('Password recovery frontend routing', () => {
  const saved = { ...process.env };
  const send = jest
    .fn<Promise<void>, [string, string, string]>()
    .mockResolvedValue(undefined);
  const user = {
    id: 7,
    ra: '123',
    name: 'Pessoa teste',
    email: 'person@example.test',
    password: 'test-hash',
  };
  const service = new AuthService(
    {
      getStudentByEmail: jest.fn().mockResolvedValue(user),
    } as unknown as StudentService,
    {
      getSecretaryByEmail: jest.fn().mockResolvedValue(user),
    } as unknown as SecretaryService,
    {
      signAsync: jest.fn().mockResolvedValue('fixture-token+with/slash'),
    } as unknown as JwtService,
    {} as HashContentService,
    { sendResetPasswordEmail: send } as unknown as MailService,
    {} as VerificationService,
  );
  beforeEach(() => {
    send.mockClear();
    process.env.FRONTEND_URL = 'https://secretary.example.test';
    delete process.env.STUDENT_APP_URL;
    delete process.env.SECRETARY_APP_URL;
  });
  afterAll(() => {
    for (const key of [
      'FRONTEND_URL',
      'STUDENT_APP_URL',
      'SECRETARY_APP_URL',
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  it('sends student recovery to student app even when FRONTEND_URL points to secretary', async () => {
    await service.sendForgotPasswordEmail(user.email, 'student');
    const url = new URL(send.mock.calls[0][2]);
    expect(url.origin).toBe(
      'https://carteirinha-digital-front-end-aluno.vercel.app',
    );
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('type')).toBe('student');
    expect(url.searchParams.get('token')).toBe('fixture-token+with/slash');
  });
  it('respects the configured student URL and preserves secretary recovery', async () => {
    process.env.STUDENT_APP_URL = 'https://student.example.test/';
    await service.sendForgotPasswordEmail(user.email, 'student');
    expect(new URL(send.mock.calls[0][2]).origin).toBe(
      'https://student.example.test',
    );
    await service.sendForgotPasswordEmail(user.email, 'secretary');
    expect(new URL(send.mock.calls[1][2]).origin).toBe(
      'https://secretary.example.test',
    );
  });
  it('uses dedicated secretary URL when configured', async () => {
    process.env.SECRETARY_APP_URL = 'https://admin.example.test';
    await service.sendForgotPasswordEmail(user.email, 'secretary');
    expect(new URL(send.mock.calls[0][2]).origin).toBe(
      'https://admin.example.test',
    );
  });
});
