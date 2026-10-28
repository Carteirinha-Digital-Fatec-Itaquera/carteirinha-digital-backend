import { EventOperationsService } from './event-operations.service';

describe('Student event history', () => {
  it('searches accents and tokens without leaking a full email and rejects short queries', async () => {
    const prisma = {
      student: {
        findMany: jest.fn().mockResolvedValue([
          {
            ra: '001',
            accountId: 'account',
            name: 'Álvaro Silva',
            email: 'alvaro@example.test',
            course: 'DSM',
            status: 'Ativo',
          },
        ]),
      },
    };
    const service = new EventOperationsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    expect(await service.searchStudents('alvaro silva')).toEqual({
      total: 1,
      items: [
        expect.objectContaining({ ra: '001', email: 'a***@example.test' }),
      ],
    });
    await expect(service.searchStudents('ab')).rejects.toThrow();
    expect(prisma.student.findMany).toHaveBeenCalledTimes(1);
  });
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
