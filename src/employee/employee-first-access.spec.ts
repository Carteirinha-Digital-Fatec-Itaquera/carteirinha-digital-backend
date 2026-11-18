import { HttpException } from '@nestjs/common';
import { EmployeeAuthService } from './employee-auth.service';
import { checkSqlRateLimit, consumeSqlRateLimit } from '../database/rate-limit.helper';

jest.mock('../database/rate-limit.helper', () => ({
  checkSqlRateLimit: jest.fn(),
  consumeSqlRateLimit: jest.fn(),
  hashRateLimitKey: jest.fn((scope: string, key: string) => scope + ':' + key),
  resetSqlRateLimit: jest.fn(),
}));

describe('Primeiro acesso com matrícula e confirmação de e-mail', () => {
  const enrolled = { id: 'employee', accountId: 'account', email: 'titular@example.test',
    accountStatus: 'ACTIVE', archivedAt: null, passwordHash: null, registrationNumber: '12345678', authVersion: 1 };
  const findByEmail = jest.fn();
  const update = jest.fn();
  const signAsync = jest.fn();
  const compareHash = jest.fn();
  const createToken = jest.fn();
  const send = jest.fn();
  let service: EmployeeAuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(checkSqlRateLimit).mockResolvedValue({ allowed: true } as never);
    jest.mocked(consumeSqlRateLimit).mockResolvedValue({ allowed: true } as never);
    findByEmail.mockResolvedValue(enrolled);
    createToken.mockResolvedValue({ id: 'activation' });
    service = new EmployeeAuthService(
      { employee: { update }, employeeAccessToken: { create: createToken, update }, employeeAudit: { create: update } } as never,
      { findByEmail } as never, {} as never, { getDisplayName: () => 'Titular fictício' } as never,
      { signAsync } as never, { compareHash } as never, { sendEmployeeAccessEmail: send } as never,
    );
  });

  it('retorna a mesma resposta pública e concede somente autorização de finalidade ACTIVATE', async () => {
    const env = process.env.EMPLOYEE_APP_URL;
    process.env.EMPLOYEE_APP_URL = 'http://localhost:5174';
    try {
      const valid = await service.requestAccess({ email: enrolled.email, registrationNumber: ' 12345678 ' }, '127.0.0.1');
      const incorrect = await service.requestAccess({ email: enrolled.email, registrationNumber: '99999999' }, '127.0.0.1');
      findByEmail.mockResolvedValue(null);
      const unknown = await service.requestAccess({ email: 'desconhecido@example.test', registrationNumber: '12345678' }, '127.0.0.1');
      expect(unknown).toEqual(incorrect);
      expect(incorrect).toEqual(valid);
      expect(createToken).toHaveBeenCalledTimes(1);
      expect(createToken).toHaveBeenCalledWith({ data: expect.objectContaining({ purpose: 'ACTIVATE', employeeId: enrolled.id }) });
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ email: enrolled.email, purpose: 'ACTIVATE' }));
      expect(signAsync).not.toHaveBeenCalled();
    } finally {
      if (env === undefined) delete process.env.EMPLOYEE_APP_URL;
      else process.env.EMPLOYEE_APP_URL = env;
    }
  });

  it('não cria token de recuperação para conta que ainda não tem senha', async () => {
    await expect(service.forgotPassword({ email: enrolled.email }, '127.0.0.1')).resolves.toMatchObject({ accepted: true });
    expect(createToken).not.toHaveBeenCalled();
  });

  it('limita tentativas antes de buscar a conta', async () => {
    jest.mocked(consumeSqlRateLimit).mockResolvedValue({ allowed: false } as never);
    const result = service.requestAccess({ email: enrolled.email, registrationNumber: '12345678' }, '127.0.0.1');
    await expect(result).rejects.toBeInstanceOf(HttpException);
    await result.catch((error: HttpException) => expect(error.getStatus()).toBe(429));
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('rejeita a matrícula antes e depois da ativação e só assina JWT com a senha pessoal', async () => {
    await expect(service.login({ email: enrolled.email, password: '12345678' }, '127.0.0.1')).rejects.toThrow('E-mail ou senha inválidos.');
    findByEmail.mockResolvedValue({ ...enrolled, passwordHash: 'hash', authVersion: 2 });
    await expect(service.login({ email: enrolled.email, password: '12345678' }, '127.0.0.1')).rejects.toThrow('E-mail ou senha inválidos.');
    expect(compareHash).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
    compareHash.mockResolvedValue(true);
    signAsync.mockResolvedValue('jwt-ficticio');
    await expect(service.login({ email: enrolled.email, password: 'senha-pessoal' }, '127.0.0.1'))
      .resolves.toMatchObject({ token: 'jwt-ficticio', mustChangePassword: false });
    expect(signAsync).toHaveBeenCalledWith({ sub: 'employee', accountId: 'account', role: 'employee', authVersion: 2 });
  });
});
