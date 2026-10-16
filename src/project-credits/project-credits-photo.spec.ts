import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectCreditsService } from './project-credits.service';
import { PrismaService } from '../database/prisma.service';
import { ProjectCreditsAssetService } from './services/project-credits-asset.service';
import { Secretary } from '@prisma/client';

describe('Credits photo lifecycle', () => {
  const secretary = { id: 1, name: 'Secretaria' } as Secretary;
  let service: ProjectCreditsService;
  const row = () => ({
    id: 'c1',
    name: 'Aluno',
    status: 'PUBLISHED',
    draftVersion: 3,
    photoStorageKey: 'project-credits/draft',
    photoConfirmed: true,
    publishedSnapshot: {
      name: 'Aluno publicado',
      photoStorageKey: 'project-credits/public',
      participations: [],
      contacts: [],
    },
  });
  const prisma = {
    projectContributor: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    projectCreditAudit: { create: jest.fn() },
    projectCreditAssetCleanup: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const assets = {
    uploadPhoto: jest.fn(),
    remove: jest.fn(),
    get: jest.fn(),
    previewUrl: jest.fn(),
  };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.projectContributor.findUnique.mockResolvedValue(row());
    prisma.projectContributor.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    assets.uploadPhoto.mockResolvedValue({ storageKey: 'project-credits/new' });
    assets.get.mockResolvedValue(Buffer.from('png'));
    service = new ProjectCreditsService(
      prisma as unknown as PrismaService,
      assets as unknown as ProjectCreditsAssetService,
    );
    jest
      .spyOn(service, 'getContributorAdmin')
      .mockResolvedValue({ id: 'c1', draftVersion: 4 } as never);
  });
  it('serves only the published snapshot, never the draft', async () => {
    prisma.projectContributor.findMany.mockResolvedValue([row()]);
    const result = await service.getPublicCredits('https://api.example');
    expect(result.contributors[0].photoUrl).toBe(
      'https://api.example/project-credits/c1/photo/public',
    );
    await expect(service.getPhoto('c1', 'draft')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.getPhoto('c1', 'public');
    expect(assets.get).toHaveBeenCalledWith('project-credits/public');
  });
  it('blocks public access when archived', async () => {
    prisma.projectContributor.findUnique.mockResolvedValue({
      ...row(),
      status: 'ARCHIVED',
    });
    await expect(service.getPhoto('c1', 'public')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(assets.get).not.toHaveBeenCalled();
  });
  it('uploads a private draft, increments version and records audit', async () => {
    await service.uploadPhoto(
      'c1',
      { expectedVersion: 3, photoConfirmed: true },
      {} as Express.Multer.File,
      secretary,
    );
    expect(prisma.projectContributor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', draftVersion: 3 },
        data: expect.objectContaining({
          photoStorageKey: 'project-credits/new',
          draftVersion: { increment: 1 },
        }),
      }),
    );
    expect(prisma.projectCreditAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PHOTO_REPLACED' }),
      }),
    );
    expect(assets.remove).toHaveBeenCalledWith('project-credits/draft');
    expect(assets.remove).not.toHaveBeenCalledWith('project-credits/public');
  });
  it('rejects stale versions before uploading', async () => {
    await expect(
      service.uploadPhoto(
        'c1',
        { expectedVersion: 2, photoConfirmed: true },
        {} as Express.Multer.File,
        secretary,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(assets.uploadPhoto).not.toHaveBeenCalled();
  });
  it('discards newly uploaded asset after a concurrent version conflict', async () => {
    prisma.projectContributor.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.uploadPhoto(
        'c1',
        { expectedVersion: 3, photoConfirmed: true },
        {} as Express.Multer.File,
        secretary,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(assets.remove).toHaveBeenCalledWith('project-credits/new');
  });
  it('removes the draft without deleting the currently published photo', async () => {
    prisma.projectContributor.findUnique.mockResolvedValue({
      ...row(),
      photoStorageKey: 'project-credits/public',
    });
    await service.removePhoto('c1', 3, secretary);
    expect(assets.remove).not.toHaveBeenCalled();
    expect(prisma.projectContributor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          photoStorageKey: null,
          photoConfirmed: false,
        }),
      }),
    );
  });
  it.each([true, false])(
    'publishes the draft photo state (has photo: %s)',
    async (hasPhoto) => {
      prisma.projectContributor.findUnique.mockResolvedValue({
        ...row(),
        photoStorageKey: hasPhoto ? 'project-credits/draft' : null,
        participations: [
          { semester: '2026.1', roles: ['Dev'], confirmed: true },
        ],
        links: [],
      });
      await service.publishContributor(
        'c1',
        { expectedVersion: 3, profileConfirmed: true },
        secretary,
      );
      expect(prisma.projectContributor.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publishedSnapshot: expect.objectContaining({
              photoStorageKey: hasPhoto ? 'project-credits/draft' : null,
            }),
          }),
        }),
      );
      expect(assets.remove).toHaveBeenCalledWith('project-credits/public');
    },
  );
  it('records failed cleanup for operational retry', async () => {
    assets.remove.mockRejectedValue(new Error('storage unavailable'));
    await service.removePhoto('c1', 3, secretary);
    expect(prisma.projectCreditAssetCleanup.create).toHaveBeenCalledWith({
      data: { storageKey: 'project-credits/draft' },
    });
  });
});
