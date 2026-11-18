import { HttpException } from '@nestjs/common';
import { EmployeeAuthService } from './employee-auth.service';
import { consumeSqlRateLimit } from '../database/rate-limit.helper';

jest.mock('../database/rate-limit.helper', () => ({
  consumeSqlRateLimit: jest.fn(),
  hashRateLimitKey: jest.fn((scope: string, key: string) => scope + ':' + key),
  resetSqlRateLimit: jest.fn(),
}));

describe('Primeiro acesso com matrícula', () => {
  const enrolled = {
    id: 'employee',
    accountId: 'account',
    email: 'titular@example.test',
    accountStatus: 'ACTIVE',
    archivedAt: null,
    passwordHash: null,
    registrationNumber: '12345678',
    authVersion: 1,
  };
  const findByEmail = jest.fn();
  const update = jest.fn();
  const signAsync = jest.fn();
  const compareHash = jest.fn();
  const createToken = jest.fn();
  const send = jest.fn();
  let service: EmployeeAuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(consumeSqlRateLimit)
      .mockResolvedValue({ allowed: true } as never);
    findByEmail.mockResolvedValue(enrolled);
    createToken.mockResolvedValue({ id: 'activation' });
    service = new EmployeeAuthService(
      {
        employee: { update },
        employeeAccessToken: { create: createToken, update },
        employeeAudit: { create: update },
        $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
          work({
            employeeAccessToken: { create: createToken },
            employeeAudit: { create: update },
          }),
      } as never,
      { findByEmail } as never,
      {} as never,
      { getDisplayName: () => 'Titular fictício' } as never,
      { signAsync } as never,
      { compareHash } as never,
      { sendEmployeeAccessEmail: send } as never,
    );
  });

  it('concede apenas uma autorização de ativação sem sessão nem e-mail', async () => {
    const result = await service.login(
      { email: enrolled.email, password: ' 12345678 ' },
      '127.0.0.1',
    );
    expect(result).toMatchObject({
      mustChangePassword: true,
      firstAccessToken: expect.any(String),
      profileType: 'employee',
    });
    expect(result).not.toHaveProperty('token');
    expect(createToken).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'ACTIVATE',
        employeeId: enrolled.id,
      }),
    });
    expect(send).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('rejeita o acesso de cadastro legado sem matrícula', async () => {
    findByEmail.mockResolvedValue({ ...enrolled, registrationNumber: null });
    await expect(
      service.login(
        { email: enrolled.email, password: '12345678' },
        '127.0.0.1',
      ),
    ).rejects.toThrow('E-mail ou senha inválidos.');
    expect(createToken).not.toHaveBeenCalled();
  });

  it('não cria token de recuperação para conta que ainda não tem senha', async () => {
    await expect(
      service.forgotPassword({ email: enrolled.email }, '127.0.0.1'),
    ).resolves.toMatchObject({ accepted: true });
    expect(createToken).not.toHaveBeenCalled();
  });

  it('limita tentativas antes de buscar a conta', async () => {
    jest
      .mocked(consumeSqlRateLimit)
      .mockResolvedValue({ allowed: false } as never);
    const result = service.login(
      { email: enrolled.email, password: '12345678' },
      '127.0.0.1',
    );
    await expect(result).rejects.toBeInstanceOf(HttpException);
    await result.catch((error: HttpException) =>
      expect(error.getStatus()).toBe(429),
    );
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('rejeita a matrícula depois da ativação e só assina JWT com a senha pessoal', async () => {
    findByEmail.mockResolvedValue({
      ...enrolled,
      passwordHash: 'hash',
      authVersion: 2,
    });
    await expect(
      service.login(
        { email: enrolled.email, password: '12345678' },
        '127.0.0.1',
      ),
    ).rejects.toThrow('E-mail ou senha inválidos.');
    expect(compareHash).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
    compareHash.mockResolvedValue(true);
    signAsync.mockResolvedValue('jwt-ficticio');
    await expect(
      service.login(
        { email: enrolled.email, password: 'senha-pessoal' },
        '127.0.0.1',
      ),
    ).resolves.toMatchObject({
      token: 'jwt-ficticio',
      mustChangePassword: false,
    });
    expect(signAsync).toHaveBeenCalledWith({
      sub: 'employee',
      accountId: 'account',
      role: 'employee',
      authVersion: 2,
    });
  });
});
