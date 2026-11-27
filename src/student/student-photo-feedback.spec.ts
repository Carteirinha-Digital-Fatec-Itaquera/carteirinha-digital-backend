import { ForbiddenException } from '@nestjs/common';
import { PhotoStatus } from '@prisma/client';
import { StudentController } from './student.controller';
import { StudentMapper } from './mapper/student.mapper';
import { StudentService } from './student.service';
import { StudentEntity } from './entities/student.entity';
import { UploadService } from '../upload/upload.service';
import type { TokenPayload } from '../auth/dto/payload.dto';
describe('Motivo da fotografia no próprio perfil do aluno', () => {
  const ra = '0000000000001',
    accountId = 'account-fixture';
  let student: StudentEntity;
  const service = { getStudentByRa: jest.fn(), validarTokenQrcode: jest.fn() };
  const controller = new StudentController(
    new StudentMapper(),
    service as unknown as StudentService,
    {} as UploadService,
  );
  const req = (role = 'student', sub = ra, account = accountId) => ({
    user: { role, sub, accountId: account } as TokenPayload,
  });
  beforeEach(() => {
    jest.clearAllMocks();
    student = Object.assign({} as StudentEntity, {
      ra,
      accountId,
      name: 'Pessoa Fictícia',
      socialName: null,
      course: 'Curso de teste',
      status: 'Em curso',
      admission: '20261',
      email: 'pessoa@example.test',
      cpf: null,
      qrcode: 'fixture-qr',
      photo: null,
      birthDate: null,
      dueDate: new Date('2030-01-01'),
      photoStatus: PhotoStatus.REJECTED,
      rejectionReason: 'A imagem está desfocada.',
    });
    service.getStudentByRa.mockResolvedValue(student);
    service.validarTokenQrcode.mockResolvedValue(student);
  });
  it('retorna motivo real e preserva campos existentes no próprio perfil', async () => {
    const result = await controller.getStudentByRa(ra, req());
    expect(result).toMatchObject({
      ra,
      name: 'Pessoa Fictícia',
      course: 'Curso de teste',
      photoStatus: 'REJECTED',
      rejectionReason: 'A imagem está desfocada.',
    });
  });
  it.each([undefined, null, '', '   '])(
    'não inventa motivo ausente/vazio: %s',
    async (reason) => {
      student.rejectionReason = reason;
      expect(
        (await controller.getStudentByRa(ra, req())).rejectionReason,
      ).toBeNull();
    },
  );
  it.each([PhotoStatus.PENDING, PhotoStatus.APPROVED])(
    'omite motivo antigo em %s, inclusive após novo upload',
    async (status) => {
      student.photoStatus = status;
      expect(
        (await controller.getStudentByRa(ra, req())).rejectionReason,
      ).toBeNull();
    },
  );
  it('omite motivo se não houver situação de fotografia', async () => {
    student.photoStatus = undefined;
    expect(
      (await controller.getStudentByRa(ra, req())).rejectionReason,
    ).toBeNull();
  });
  it('preserva motivo longo e texto original sem transformá-lo em HTML', async () => {
    const reason = '<b>Motivo real</b> ' + 'Texto longo. '.repeat(200);
    student.rejectionReason = reason;
    expect((await controller.getStudentByRa(ra, req())).rejectionReason).toBe(
      reason,
    );
  });
  it('não adiciona o motivo na resposta para Secretaria', async () => {
    expect(
      await controller.getStudentByRa(
        ra,
        req('secretary', 'secretary-fixture'),
      ),
    ).not.toHaveProperty('rejectionReason');
  });
  it('não adiciona motivo na projeção pública do QR Code', async () => {
    expect(
      await controller.verificarTokenQrcode('fixture-qr'),
    ).not.toHaveProperty('rejectionReason');
  });
  it('não permite consultar outro RA e nem consulta o serviço', async () => {
    await expect(
      controller.getStudentByRa(ra, req('student', 'outro-ra')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getStudentByRa).not.toHaveBeenCalled();
  });
  it('não permite cruzar accountId mesmo com RA igual', async () => {
    await expect(
      controller.getStudentByRa(ra, req('student', ra, 'outra-conta')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
