import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService JWT payloads', () => {
  const studentService = {
    getStudentByEmail: jest.fn(),
    updateLastLoginStudent: jest.fn(),
  };
  const secretaryService = {
    getSecretaryByEmail: jest.fn(),
    updateLastLogin: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const hashService = {
    compareHash: jest.fn(),
  };
  const mailService = {};
  const verificationService = {
    verifyCode: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue('signed-token');
    hashService.compareHash.mockResolvedValue(true);
    service = new AuthService(
      studentService as any,
      secretaryService as any,
      jwtService as any,
      hashService as any,
      mailService as any,
      verificationService as any,
    );
  });
  it('signs student login with sub, role and accountId', async () => {
    studentService.getStudentByEmail.mockResolvedValue({
      ra: '000123',
      accountId: 'student-account-id',
      email: 'student@example.invalid',
      password: 'hash',
      lastLogin: null,
    });

    await expect(
      service.signInStudent('student@example.invalid', 'password'),
    ).resolves.toEqual({
      accessToken: 'signed-token',
      firstLogin: true,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: '000123',
      role: 'student',
      accountId: 'student-account-id',
      firstLogin: true,
    });
  });

  it('signs secretary login with normalized identity and role', async () => {
    secretaryService.getSecretaryByEmail.mockResolvedValue({
      id: 7,
      email: 'secretary@example.invalid',
      password: 'hash',
      dueDate: new Date('2030-01-01T00:00:00.000Z'),
      lastLogin: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.signInSecretary('secretary@example.invalid', 'password');

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 7,
      role: 'secretary',
      firstLogin: false,
      isExpired: false,
    });
  });

  it('signs verification-code login with canonical student payload', async () => {
    verificationService.verifyCode.mockResolvedValue(true);
    studentService.getStudentByEmail.mockResolvedValue({
      ra: '000123',
      accountId: 'student-account-id',
      name: 'Student',
      email: 'student@example.invalid',
    });

    const response = await service.verifyCodeAndLogin(
      'student@example.invalid',
      '123456',
    );

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: '000123',
      role: 'student',
      accountId: 'student-account-id',
      email: 'student@example.invalid',
    });
    expect(response.access_token).toBe('signed-token');
  });
  it('rejects student login when immutable account identity is absent', async () => {
    studentService.getStudentByEmail.mockResolvedValue({
      ra: '000123',
      email: 'student@example.invalid',
      password: 'hash',
      lastLogin: null,
    });

    await expect(
      service.signInStudent('student@example.invalid', 'password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
