import type { Attendance } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AttendanceService } from './attendance.service';

const eventId = '11111111-1111-4111-8111-111111111111';
const student = {
  ra: '000123',
  accountId: 'account-one',
  name: 'Aluno',
  course: 'DSM',
  status: 'Em curso',
};
const user = {
  sub: student.ra,
  accountId: student.accountId,
  role: 'student' as const,
};

describe('AttendanceService', () => {
  const jwt = new JwtService();
  let service: AttendanceService;
  let state: {
    student: typeof student | null;
    event: { id: string; title: string; status: string } | null;
    checkpoint: { isOpen: boolean; version: number };
    attendance: Partial<Attendance> | null;
  };
  const tx = {
    $queryRaw: jest.fn(),
    attendance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(),
    event: { findUnique: jest.fn() },
    attendance: tx.attendance,
    $queryRaw: jest.fn(),
  };
  function token(overrides: object = {}, secret = 'qr-test-secret') {
    const iat = Math.floor(Date.now() / 1000);
    const payload = Object.fromEntries(
      Object.entries({
        eventId,
        checkpoint: 'CHECK_IN',
        checkpointVersion: 2,
        jti: randomUUID(),
        iat,
        exp: iat + 20,
        ...overrides,
      }).filter(([, value]) => value !== undefined),
    );
    return jwt.sign(payload, { secret });
  }

  async function code(promise: Promise<unknown>, expected: string) {
    try {
      await promise;
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: expected }),
      );
    }
  }
  beforeEach(() => {
    process.env.JWT_SECRET = 'login-test-secret';
    process.env.ATTENDANCE_QR_SECRET = 'qr-test-secret';
    jest.clearAllMocks();
    state = {
      student: { ...student },
      event: { id: eventId, title: 'Palestra', status: 'IN_PROGRESS' },
      checkpoint: { isOpen: true, version: 2 },
      attendance: null,
    };
    tx.$queryRaw.mockImplementation((sql: TemplateStringsArray) => {
      const query = sql.join('');
      if (query.includes('FROM "Student"'))
        return Promise.resolve(state.student ? [state.student] : []);
      if (query.includes('FROM "EventCheckpoint"'))
        return Promise.resolve([state.checkpoint]);
      if (query.includes('FROM "Event"'))
        return Promise.resolve(state.event ? [state.event] : []);
      return Promise.resolve([]);
    });
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(tx),
    );
    tx.attendance.findUnique.mockImplementation(() =>
      Promise.resolve(state.attendance),
    );
    tx.attendance.create.mockResolvedValue({});
    tx.attendance.update.mockResolvedValue({});
    service = new AttendanceService(prisma as unknown as PrismaService, jwt);
  });
  it('creates check-in with authenticated identity, snapshots and server time', async () => {
    const before = Date.now();
    const result = await service.scan(token(), user);
    expect(result).toMatchObject({
      success: true,
      type: 'CHECK_IN',
      status: 'CHECKED_IN',
      eventTitle: 'Palestra',
    });
    expect(Date.parse(result.timestamp)).toBeGreaterThanOrEqual(before);
    expect(tx.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId,
        studentRa: student.ra,
        studentRefRa: student.ra,
        studentAccountId: student.accountId,
        studentName: student.name,
        studentCourse: student.course,
        checkInAt: expect.any(Date) as Date,
      }) as Partial<Attendance>,
    });
  });
  it.each(['CHECK_IN', 'CHECK_OUT'])(
    'duplicate %s does not write or overwrite time',
    async (checkpoint) => {
      state.attendance = {
        studentRefRa: student.ra,
        studentAccountId: student.accountId,
        checkInAt: new Date(),
        checkOutAt: new Date(),
      };
      await expect(
        service.scan(token({ checkpoint }), user),
      ).resolves.toMatchObject({
        success: false,
        code:
          checkpoint === 'CHECK_IN'
            ? 'ALREADY_CHECKED_IN'
            : 'ALREADY_CHECKED_OUT',
      });
      expect(tx.attendance.create).not.toHaveBeenCalled();
      expect(tx.attendance.update).not.toHaveBeenCalled();
    },
  );
  it('rejects checkout without check-in', async () =>
    code(
      service.scan(token({ checkpoint: 'CHECK_OUT' }), user),
      'CHECK_IN_REQUIRED',
    ));
  it('confirms checkout', async () => {
    state.attendance = {
      studentRefRa: student.ra,
      studentAccountId: student.accountId,
      checkInAt: new Date(),
      checkOutAt: null,
    };
    await expect(
      service.scan(token({ checkpoint: 'CHECK_OUT' }), user),
    ).resolves.toMatchObject({ success: true, status: 'CONFIRMED' });
    expect(tx.attendance.update).toHaveBeenCalledWith({
      where: { eventId_studentRa: { eventId, studentRa: student.ra } },
      data: { status: 'CONFIRMED', checkOutAt: expect.any(Date) as Date },
    });
  });
  it('rejects expiration', async () =>
    code(service.scan(token({ iat: 1, exp: 2 }), user), 'QR_EXPIRED'));
  it('rejects wrong signature', async () =>
    code(service.scan(token({}, 'wrong-secret'), user), 'INVALID_QR_TOKEN'));
  it.each([
    { checkpoint: undefined, type: 'CHECK_IN' },
    { exp: undefined },
    { checkpointVersion: 0 },
    { eventId: 'bad' },
    { jti: undefined },
  ])('rejects malformed signed claims %j', async (claims) =>
    code(service.scan(token(claims), user), 'INVALID_QR_TOKEN'),
  );
  it('rejects closed checkpoint', async () => {
    state.checkpoint.isOpen = false;
    await code(service.scan(token(), user), 'CHECKPOINT_CLOSED');
  });
  it('rejects obsolete version', async () => {
    state.checkpoint.version = 3;
    await code(service.scan(token(), user), 'QR_VERSION_MISMATCH');
  });
  it('rejects cancelled event', async () => {
    state.event!.status = 'CANCELLED';
    await code(service.scan(token(), user), 'EVENT_CANCELLED');
  });
  it('returns 404 for missing event', async () => {
    state.event = null;
    await expect(service.scan(token(), user)).rejects.toMatchObject({
      status: 404,
    });
  });
  it.each(['missing', 'inactive', 'changed-account'])(
    'rejects %s account for scan and private listing',
    async (condition) => {
      if (condition === 'missing') state.student = null;
      if (condition === 'inactive') state.student!.status = 'Concluído';
      if (condition === 'changed-account')
        state.student!.accountId = 'new-account';
      await expect(service.scan(token(), user)).rejects.toMatchObject({
        status: 401,
      });
      await expect(service.findMine(user)).rejects.toMatchObject({
        status: 401,
      });
    },
  );
  it('refuses reused RA without exposing or overwriting old attendance', async () => {
    state.attendance = {
      studentAccountId: 'old-account',
      studentRefRa: null,
      checkInAt: new Date(),
    };
    await code(service.scan(token(), user), 'RA_REUSE_HISTORY_CONFLICT');
    expect(tx.attendance.update).not.toHaveBeenCalled();
  });
  it('filters my attendances by both current FK and accountId; returns minimal shape', async () => {
    tx.attendance.findMany.mockResolvedValue([
      {
        id: 'a',
        eventId,
        event: { title: 'Palestra' },
        checkInAt: new Date('2026-01-01T00:00:00Z'),
        checkOutAt: null,
        status: 'CHECKED_IN',
      },
    ]);
    expect(await service.findMine(user)).toEqual([
      {
        id: 'a',
        eventId,
        eventTitle: 'Palestra',
        checkInAt: '2026-01-01T00:00:00.000Z',
        checkOutAt: null,
        status: 'CHECKED_IN',
      },
    ]);
    expect(tx.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentRa: student.ra,
          studentRefRa: student.ra,
          studentAccountId: student.accountId,
        },
      }),
    );
  });
  it('summary reads one aggregate and unknown event gives 404', async () => {
    prisma.event.findUnique.mockResolvedValue({ id: eventId });
    prisma.$queryRaw.mockResolvedValue([
      { checkedInCount: 3, checkedOutCount: 2, confirmedCount: 2 },
    ]);
    expect(await service.summary(eventId)).toEqual({
      checkedInCount: 3,
      checkedOutCount: 2,
      confirmedCount: 2,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.summary(eventId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
