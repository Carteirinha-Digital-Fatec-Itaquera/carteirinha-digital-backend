import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { EventCatalogService } from './event-catalog.service';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from './event-storage.service';
import { CatalogVersionDto, UpdateTemplateDto } from './public-events.dto';

describe('CRUD do catálogo de certificados', () => {
  function setup() {
    const template = {
      id: 't',
      name: 'Modelo final',
      role: 'ATTENDEE',
      version: 2,
      status: 'PUBLISHED',
      config: {
        heading: 'CERTIFICADO',
        edition: 'Semana',
        design: 'TECHNOLOGY_BLUE_2026_DARK',
      },
    };
    const signer = {
      id: 's',
      name: 'Nome original',
      title: 'Coordenador',
      course: null,
      assetId: 'asset-original',
      archived: false,
      version: 3,
    };
    const tx = {
      certificateTemplate: {
        findUnique: jest.fn(
          (): Promise<typeof template | null> => Promise.resolve(template),
        ),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(template)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      certificateSigner: {
        findUnique: jest.fn(() => Promise.resolve(signer)),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(signer)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      eventAudit: { create: jest.fn(() => Promise.resolve({ id: 'audit' })) },
    };
    const prisma = {
      $transaction: <T>(callback: (value: typeof tx) => Promise<T>) =>
        callback(tx),
      eventAsset: {
        findFirst: jest.fn(() => Promise.resolve({ id: 'asset-new' })),
      },
    };
    const service = new EventCatalogService(
      prisma as unknown as PrismaService,
      {} as EventStorageService,
    );
    return { service, tx, prisma, template, signer };
  }
  const dto = {
    name: 'Modelo corrigido',
    role: 'ATTENDEE',
    heading: 'CERTIFICADO CORRIGIDO',
    edition: 'Semana corrigida',
    expectedVersion: 2,
    textColor: '#FFFFFF',
  };
  it('edita modelo conservando design e identidade do registro', async () => {
    const { service, tx, template } = setup();
    const before = JSON.stringify(template);
    await service.updateTemplate('t', dto, 7);
    expect(tx.certificateTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 't', version: 2, status: { not: 'ARCHIVED' } },
      data: {
        name: dto.name,
        config: {
          ...template.config,
          heading: dto.heading,
          textColor: dto.textColor,
          edition: dto.edition,
        },
        version: { increment: 1 },
      },
    });
    expect(tx.eventAudit.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(template)).toBe(before);
  });
  it('rejeita edição concorrente sem auditar sucesso', async () => {
    const { service, tx } = setup();
    tx.certificateTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateTemplate('t', dto, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.eventAudit.create).not.toHaveBeenCalled();
  });
  it('impede mudar papel de um modelo vinculado', async () => {
    const { service, tx } = setup();
    await expect(
      service.updateTemplate('t', { ...dto, role: 'SPEAKER' }, 7),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.certificateTemplate.updateMany).not.toHaveBeenCalled();
  });
  it('substitui imagem de assinatura sem excluir o asset original', async () => {
    const { service, tx, signer } = setup();
    await service.updateSigner(
      's',
      {
        name: 'Nome corrigido',
        title: 'Diretor',
        assetId: 'asset-new',
        authorized: true,
        expectedVersion: 3,
      },
      7,
    );
    expect(tx.certificateSigner.updateMany).toHaveBeenCalledWith({
      where: { id: 's', version: 3, archived: false },
      data: {
        name: 'Nome corrigido',
        title: 'Diretor',
        course: null,
        assetId: 'asset-new',
        authorizedAt: expect.any(Date) as Date,
        version: { increment: 1 },
      },
    });
    expect(signer.assetId).toBe('asset-original');
  });
  it('exige autorização da assinatura', async () => {
    const { service } = setup();
    await expect(
      service.updateSigner(
        's',
        {
          name: 'Nome',
          title: 'Diretor',
          assetId: 'asset-new',
          authorized: false,
          expectedVersion: 3,
        },
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each(['templates', 'signers'] as const)(
    'exclui %s logicamente em transação com auditoria',
    async (kind) => {
      const { service, tx } = setup();
      await expect(
        service.deleteCatalogItem(kind, 'id', 2, 7),
      ).resolves.toEqual({ success: true });
      expect(tx.eventAudit.create).toHaveBeenCalledTimes(1);
      expect(
        kind === 'templates'
          ? tx.certificateTemplate.updateMany
          : tx.certificateSigner.updateMany,
      ).toHaveBeenCalledTimes(1);
    },
  );
  it('retorna 404 para cadastro inexistente na exclusão', async () => {
    const { service, tx } = setup();
    tx.certificateTemplate.updateMany.mockResolvedValue({ count: 0 });
    tx.certificateTemplate.findUnique.mockResolvedValue(null);
    await expect(
      service.deleteCatalogItem('templates', 'missing', 1, 7),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.eventAudit.create).not.toHaveBeenCalled();
  });
  it('rejeita versão ausente ou inválida na fronteira HTTP', async () => {
    expect((await validate(new CatalogVersionDto())).length).toBeGreaterThan(0);
    expect(
      (
        await validate(
          Object.assign(new CatalogVersionDto(), { expectedVersion: 0 }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(Object.assign(new UpdateTemplateDto(), dto))).length,
    ).toBe(0);
    expect(
      (
        await validate(
          Object.assign(new UpdateTemplateDto(), dto, {
            textColor: 'red;background:url(x)',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
