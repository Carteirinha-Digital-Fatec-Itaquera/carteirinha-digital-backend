/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  CertificateController,
  CertificateVerificationController,
} from './certificate.controller';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { StreamableFile } from '@nestjs/common';

describe('Certificate Controllers Unit Tests', () => {
  let certificateServiceMock: any;
  let verificationController: CertificateVerificationController;
  let certificateController: CertificateController;

  const mockUser: TokenPayload = {
    sub: '0123456789',
    accountId: 'acc-1',
    role: 'student',
    email: 'aluno@fatec.sp.gov.br',
    name: 'Aluno Teste',
  };

  beforeEach(() => {
    certificateServiceMock = {
      verifyCertificate: jest.fn(),
      getStudentCertificates: jest.fn(),
      getStudentCertificate: jest.fn(),
      generatePdf: jest.fn(),
    };

    verificationController = new CertificateVerificationController(
      certificateServiceMock,
    );
    certificateController = new CertificateController(certificateServiceMock);
  });

  describe('CertificateVerificationController', () => {
    it('verify: delegates code to certificateService.verifyCertificate', async () => {
      const mockResponse = {
        valid: true,
        code: 'FATEC-EVT-0123456789ABCDEF',
        studentName: 'Aluno Teste',
      };
      certificateServiceMock.verifyCertificate.mockResolvedValue(mockResponse);

      const result = await verificationController.verify(
        'FATEC-EVT-0123456789ABCDEF',
      );
      expect(result).toEqual(mockResponse);
      expect(certificateServiceMock.verifyCertificate).toHaveBeenCalledWith(
        'FATEC-EVT-0123456789ABCDEF',
      );
    });
  });

  describe('CertificateController', () => {
    it('findMine: delegates to getStudentCertificates with user payload', async () => {
      const mockList = [{ id: 'cert-1', verificationCode: 'FATEC-EVT-1' }];
      certificateServiceMock.getStudentCertificates.mockResolvedValue(mockList);

      const result = await certificateController.findMine({ user: mockUser });
      expect(result).toEqual(mockList);
      expect(
        certificateServiceMock.getStudentCertificates,
      ).toHaveBeenCalledWith(mockUser);
    });

    it('findOne: delegates to getStudentCertificate with id and user', async () => {
      const mockCert = { id: 'cert-1', verificationCode: 'FATEC-EVT-1' };
      certificateServiceMock.getStudentCertificate.mockResolvedValue(mockCert);

      const result = await certificateController.findOne('cert-1', {
        user: mockUser,
      });
      expect(result).toEqual(mockCert);
      expect(certificateServiceMock.getStudentCertificate).toHaveBeenCalledWith(
        'cert-1',
        mockUser,
      );
    });

    it('downloadPdf: returns StreamableFile and sets headers on response', async () => {
      const pdfBuffer = Buffer.from('%PDF-dummy-content');
      certificateServiceMock.generatePdf.mockResolvedValue({
        buffer: pdfBuffer,
        verificationCode: 'FATEC-EVT-TEST12345678',
      });

      const resHeaders: Record<string, string> = {};
      const resMock: any = {
        setHeader: jest.fn((k: string, v: string) => {
          resHeaders[k] = v;
        }),
      };

      const result = await certificateController.downloadPdf(
        'cert-1',
        { user: mockUser },
        resMock,
      );
      expect(result).toBeInstanceOf(StreamableFile);
      expect(resHeaders['Content-Type']).toBe('application/pdf');
      expect(resHeaders['Content-Disposition']).toBe(
        'attachment; filename="certificado-FATEC-EVT-TEST12345678.pdf"',
      );
      expect(resHeaders['Cache-Control']).toBe('no-store');
    });
  });
});
