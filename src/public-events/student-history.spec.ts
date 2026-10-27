import { EventOperationsService } from './event-operations.service';

describe('Student event history', () => {
  it('scopes legacy and linked attendances to the current account, never RA alone', async () => {
    const tx = {
      student: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountId: 'current-account' }),
      },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new EventOperationsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    expect(await service.studentHistory('001')).toEqual([]);
    expect(tx.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentRa: '001', studentAccountId: 'current-account' },
      }),
    );
    tx.student.findUnique.mockResolvedValue(null);
    await expect(service.studentHistory('missing')).rejects.toThrow(
      'Aluno não encontrado',
    );
    expect(tx.attendance.findMany).toHaveBeenCalledTimes(1);
  });
});
