/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { NotFoundException } from '@nestjs/common';
import { lockEventForMutation } from './event-mutation-lock';

describe('lockEventForMutation', () => {
  it('throws NotFoundException when event does not exist', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      event: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    await expect(
      lockEventForMutation(tx as any, 'non-existent-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('locks checkpoints ordered by type/id, locks event, and returns re-read state', async () => {
    const mockCheckpoints = [
      {
        id: 'cp-1',
        eventId: 'evt-1',
        type: 'CHECK_IN',
        isOpen: false,
        version: 1,
      },
      {
        id: 'cp-2',
        eventId: 'evt-1',
        type: 'CHECK_OUT',
        isOpen: false,
        version: 1,
      },
    ];
    const mockEvent = {
      id: 'evt-1',
      title: 'Evento Teste',
      status: 'SCHEDULED',
      checkpoints: mockCheckpoints,
    };

    const queryRawMock = jest.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: queryRawMock,
      event: {
        findUnique: jest.fn().mockResolvedValue(mockEvent),
      },
    };

    const state = await lockEventForMutation(tx as any, 'evt-1');

    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(tx.event.findUnique).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      include: {
        checkpoints: {
          orderBy: [{ type: 'asc' }, { id: 'asc' }],
        },
      },
    });
    expect(state.event.id).toBe('evt-1');
    expect(state.checkpoints).toEqual(mockCheckpoints);
  });
});
