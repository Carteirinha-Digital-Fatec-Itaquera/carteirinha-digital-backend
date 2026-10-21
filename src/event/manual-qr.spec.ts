import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CheckpointService } from './checkpoint.service';

describe('Atualização manual do QR', () => {
  const checkpoint = {
    id: 'checkpoint',
    eventId: 'event',
    type: 'CHECK_IN' as const,
    isOpen: true,
    version: 3,
    openedAt: new Date(),
    closesAt: new Date(Date.now() + 60000),
  };
  function setup(
    status = 'IN_PROGRESS',
    open = true,
    closesAt = checkpoint.closesAt,
  ) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      event: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'event',
          status,
          checkpoints: [{ ...checkpoint, isOpen: open, closesAt }],
        }),
      },
      eventCheckpoint: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...checkpoint, version: 4 }),
      },
      eventAudit: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new CheckpointService({
      $transaction: (action: (client: typeof tx) => unknown) => action(tx),
    } as unknown as PrismaService);
    return { service, tx };
  }
  it('invalida a versão anterior sem alterar abertura ou limite da janela', async () => {
    const { service, tx } = setup();
    const response = await service.refreshQr('event', 'CHECK_IN', 7);
    expect(response.version).toBe(4);
    expect(tx.eventCheckpoint.updateMany).toHaveBeenCalledWith({
      where: { id: 'checkpoint', isOpen: true, version: 3 },
      data: { isOpen: true, version: { increment: 1 } },
    });
    expect(tx.eventAudit.create).toHaveBeenCalledWith({
      data: { eventId: 'event', action: 'QR_REFRESH_CHECK_IN', secretaryId: 7 },
    });
  });
  it.each([
    ['CANCELLED', true, checkpoint.closesAt],
    ['IN_PROGRESS', false, checkpoint.closesAt],
    ['IN_PROGRESS', true, new Date(0)],
  ])(
    'não gera QR para estado indisponível %s',
    async (status, open, closesAt) => {
      const { service, tx } = setup(status, open, closesAt);
      await expect(service.refreshQr('event', 'CHECK_IN', 7)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.eventCheckpoint.updateMany).not.toHaveBeenCalled();
    },
  );
});
