/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SecretaryService } from './secretary.service';

describe('SecretaryService Security Validations', () => {
  let service: SecretaryService;

  const mockRepository = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updatePassword: jest.fn(),
    delete: jest.fn(),
  };

  const mockPrisma = {
    verificationCode: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockMapper = {
    toEntity: jest.fn().mockImplementation((val) => val),
  };

  const mockHashService = {
    hashContent: jest.fn().mockResolvedValue('hashed_password'),
  };

  const mockMailService = {
    sendVerificationCode: jest.fn().mockResolvedValue(undefined),
  };

  const mockStudentService = {
    getPendingPhotos: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretaryService(
      mockMapper as any,
      mockRepository as any,
      mockHashService as any,
      mockPrisma as any,
      mockStudentService as any,
      mockMailService as any,
    );
  });

  describe('updateSecretaryFromDto', () => {
    it('throws NotFoundException if secretary does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);
      await expect(
        service.updateSecretaryFromDto(999, { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects email not ending with @cps.sp.gov.br', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 1,
        email: 'valido@cps.sp.gov.br',
      });

      await expect(
        service.updateSecretaryFromDto(1, { email: 'malicious@gmail.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects email already in use by another secretary', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 1,
        email: 'sec1@cps.sp.gov.br',
      });
      mockRepository.findByEmail.mockResolvedValue({
        id: 2,
        email: 'sec2@cps.sp.gov.br',
      });

      await expect(
        service.updateSecretaryFromDto(1, { email: 'sec2@cps.sp.gov.br' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows updating when email is valid and belongs to same user or unchanged', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 1,
        email: 'sec1@cps.sp.gov.br',
      });
      mockRepository.findByEmail.mockResolvedValue({
        id: 1,
        email: 'sec1@cps.sp.gov.br',
      });
      mockRepository.update.mockResolvedValue(undefined);

      const result = await service.updateSecretaryFromDto(1, {
        name: 'Updated Name',
      });
      expect(result).toEqual({ message: 'Secretaria atualizada com sucesso' });
    });
  });

  describe('confirmSecretary', () => {
    it('rejects if email domain is not @cps.sp.gov.br', async () => {
      await expect(
        service.confirmSecretary('fake@gmail.com', '123456', {
          name: 'Fake',
          email: 'fake@gmail.com',
          birthDate: new Date('1990-01-01'),
          dueDate: '2026-12-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if body secretary.email diverges from verified email', async () => {
      await expect(
        service.confirmSecretary('verified@cps.sp.gov.br', '123456', {
          name: 'Mismatch',
          email: 'other@cps.sp.gov.br',
          birthDate: new Date('1990-01-01'),
          dueDate: '2026-12-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if email is already registered', async () => {
      mockRepository.findByEmail.mockResolvedValue({ id: 5 });
      await expect(
        service.confirmSecretary('already@cps.sp.gov.br', '123456', {
          name: 'Already Exists',
          email: 'already@cps.sp.gov.br',
          birthDate: new Date('1990-01-01'),
          dueDate: '2026-12-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if verification code is invalid or expired', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockPrisma.verificationCode.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmSecretary('sec@cps.sp.gov.br', '999999', {
          name: 'Valid',
          email: 'sec@cps.sp.gov.br',
          birthDate: new Date('1990-01-01'),
          dueDate: '2026-12-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates secretary and binds verified email when code is valid', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockPrisma.verificationCode.findFirst.mockResolvedValue({
        id: 42,
        email: 'sec@cps.sp.gov.br',
        code: '123456',
      });
      mockPrisma.verificationCode.update.mockResolvedValue({ id: 42 });
      mockRepository.create.mockResolvedValue({
        id: 7,
        email: 'sec@cps.sp.gov.br',
      });

      const result = await service.confirmSecretary(
        'sec@cps.sp.gov.br',
        '123456',
        {
          name: 'Sec Valid',
          email: 'sec@cps.sp.gov.br',
          birthDate: new Date('1990-01-01'),
          dueDate: '2026-12-31',
        },
      );

      expect(mockPrisma.verificationCode.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { used: true },
      });
      expect(result).toEqual({ id: 7, email: 'sec@cps.sp.gov.br' });
    });
  });
});
