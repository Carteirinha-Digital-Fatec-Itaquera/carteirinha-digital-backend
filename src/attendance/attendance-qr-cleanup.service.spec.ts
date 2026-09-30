import { AttendanceQrCleanupService } from './attendance-qr-cleanup.service';
import { PrismaService } from '../database/prisma.service';

describe('AttendanceQrCleanupService', () => {
  let service: AttendanceQrCleanupService;
  let prisma: {
    attendanceQrReference: {
      deleteMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      attendanceQrReference: {
        deleteMany: jest.fn(),
      },
    };
    service = new AttendanceQrCleanupService(prisma as unknown as PrismaService);
  });

  it('deletes references expired more than 5 minutes ago', async () => {
    prisma.attendanceQrReference.deleteMany.mockResolvedValue({ count: 5 });

    const beforeCall = Date.now();
    const count = await service.cleanupExpiredReferences();
    const afterCall = Date.now();

    expect(count).toBe(5);
    expect(prisma.attendanceQrReference.deleteMany).toHaveBeenCalledTimes(1);

    const callArg = prisma.attendanceQrReference.deleteMany.mock.calls[0][0];
    const thresholdDate = callArg.where.expiresAt.lt as Date;
    expect(thresholdDate).toBeInstanceOf(Date);

    // Threshold should be approximately 5 minutes (300,000 ms) ago
    const expectedMinThreshold = beforeCall - 5 * 60 * 1000 - 100;
    const expectedMaxThreshold = afterCall - 5 * 60 * 1000 + 100;
    expect(thresholdDate.getTime()).toBeGreaterThanOrEqual(expectedMinThreshold);
    expect(thresholdDate.getTime()).toBeLessThanOrEqual(expectedMaxThreshold);
  });

  it('handles zero deleted records gracefully', async () => {
    prisma.attendanceQrReference.deleteMany.mockResolvedValue({ count: 0 });
    const count = await service.cleanupExpiredReferences();
    expect(count).toBe(0);
  });
});
