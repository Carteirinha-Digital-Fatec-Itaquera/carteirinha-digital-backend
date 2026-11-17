import { createHash } from 'node:crypto';
import type { PrismaService } from './prisma.service';

export function hashRateLimitKey(prefix: string, rawValue: string): string {
  const digest = createHash('sha256').update(rawValue).digest('hex');
  return `${prefix}:${digest}`;
}

export async function consumeSqlRateLimit(
  prisma: PrismaService,
  key: string,
  limit: number,
  windowMs: number,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const nextExpiresAt = new Date(now.getTime() + windowMs);

  const existing = await prisma.eventRateLimit.findUnique({
    where: { key },
  });

  if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
    await prisma.eventRateLimit.upsert({
      where: { key },
      update: { count: 1, expiresAt: nextExpiresAt },
      create: { key, count: 1, expiresAt: nextExpiresAt },
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }

  const updated = await prisma.eventRateLimit.update({
    where: { key },
    data: { count: { increment: 1 } },
  });

  if (updated.count > limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((updated.expiresAt.getTime() - now.getTime()) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function checkSqlRateLimit(
  prisma: PrismaService,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const existing = await prisma.eventRateLimit.findUnique({
    where: { key },
  });

  if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function resetSqlRateLimit(
  prisma: PrismaService,
  key: string,
): Promise<void> {
  await prisma.eventRateLimit.deleteMany({ where: { key } });
}
