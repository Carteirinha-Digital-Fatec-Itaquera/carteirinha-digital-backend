import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { loadAuthSecrets } from '../auth/auth.config';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterVisitorDto, VerifyVisitorDto } from './public-events.dto';

export const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const visitorIdentityHash = (value: string) =>
  createHmac(
    'sha256',
    process.env.VISITOR_IDENTITY_SECRET || loadAuthSecrets().jwtSecret,
  )
    .update(`visitor-v1:${value}`)
    .digest('hex');
export function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (let digit = 9; digit <= 10; digit++) {
    let sum = 0;
    for (let i = 0; i < digit; i++) sum += Number(value[i]) * (digit + 1 - i);
    const remainder = (sum * 10) % 11;
    if ((remainder === 10 ? 0 : remainder) !== Number(value[digit]))
      return false;
  }
  return true;
}
@Injectable()
export class VisitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}
  async limit(key: string, maximum: number, seconds: number) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const row = await this.prisma.eventRateLimit.upsert({
      where: { key: tokenHash(`${key}:${bucket}`) },
      create: {
        key: tokenHash(`${key}:${bucket}`),
        expiresAt: new Date((bucket + 1) * seconds * 1000),
      },
      update: { count: { increment: 1 } },
    });
    if (row.count > maximum)
      throw new HttpException(
        'Muitas tentativas. Aguarde antes de tentar novamente.',
        429,
      );
  }
  async register(
    dto: RegisterVisitorDto,
    ip: string,
    existingSessionToken?: string,
  ) {
    // Um auditório pode compartilhar o mesmo NAT/proxy; o limite por contato é o controle principal.
    await this.limit(`register:${ip}`, 1000, 600);
    const series = await this.prisma.eventSeries.findUnique({
      where: { id: dto.seriesId },
    });
    if (
      !series?.published ||
      series.retentionAt <= new Date() ||
      series.purgedAt
    )
      throw new NotFoundException('Inscrições indisponíveis.');
    if (dto.course && !series.courses.includes(dto.course))
      throw new BadRequestException('Curso não pertence à edição.');
    const email = dto.email.trim().toLowerCase();
    const emailHash = visitorIdentityHash(email);
    await this.limit(`contact:${emailHash}`, 60, 86400);
    const cpf = dto.cpf?.replace(/\D/g, '');
    if (!cpf || !validCpf(cpf))
      throw new BadRequestException(
        'Informe um CPF válido para recuperar seus certificados.',
      );
    const cpfHash = cpf ? visitorIdentityHash(`cpf:${cpf}`) : null;

    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { purgedAt: Date | null; retentionAt: Date }[]
      >`SELECT "purgedAt", "retentionAt" FROM "EventSeries" WHERE "id" = ${dto.seriesId} FOR SHARE`;
      if (!locked || locked.purgedAt || locked.retentionAt <= new Date())
        throw new NotFoundException('Inscrições encerradas.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.seriesId + emailHash}, 0))::text`;
      if (cpfHash)
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.seriesId + cpfHash}, 0))::text`;

      let existing = await tx.visitorRegistration.findUnique({
        where: { seriesId_emailHash: { seriesId: dto.seriesId, emailHash } },
      });
      if (cpfHash) {
        const existingByCpf = await tx.visitorRegistration.findFirst({
          where: { seriesId: dto.seriesId, cpfHash },
        });
        if (existingByCpf) {
          if (existing && existing.id !== existingByCpf.id) {
            throw new ConflictException(
              'Identificação já cadastrada nesta edição. Se você perdeu o acesso, procure o atendimento da Secretaria presencialmente.',
            );
          }
          existing = existing || existingByCpf;
        }
      }

      if (existing) {
        if (existingSessionToken && /^[\w-]{43}$/.test(existingSessionToken)) {
          const session = await tx.visitorSession.findUnique({
            where: { tokenHash: tokenHash(existingSessionToken) },
          });
          if (
            session &&
            session.visitorId === existing.id &&
            session.expiresAt > new Date()
          ) {
            return {
              token: existingSessionToken,
              expiresAt: session.expiresAt,
              visitorId: existing.id,
            };
          }
        }
        throw new ConflictException(
          'Identificação já cadastrada nesta edição. Se você perdeu o acesso, procure o atendimento da Secretaria presencialmente.',
        );
      }

      const registration = await tx.visitorRegistration.create({
        data: {
          seriesId: dto.seriesId,
          name: dto.name.trim(),
          course: dto.course || null,
          email,
          emailHash,
          cpfHash,
          identifiedAt: new Date(),
          verifiedAt: null,
        },
      });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(
        Math.min(Date.now() + 12 * 3600000, locked.retentionAt.getTime()),
      );
      await tx.visitorSession.create({
        data: {
          visitorId: registration.id,
          tokenHash: tokenHash(token),
          expiresAt,
        },
      });
      return { token, expiresAt, visitorId: registration.id };
    });
  }
  async verify(dto: VerifyVisitorDto, ip: string) {
    await this.limit(`verify:${ip}`, 5000, 600);
    const registration = await this.prisma.visitorRegistration.findUnique({
      where: { id: dto.registrationId },
      select: { seriesId: true },
    });
    if (!registration)
      throw new UnauthorizedException('Código inválido ou expirado.');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EventSeries" WHERE "id" = ${registration.seriesId} FOR SHARE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.registrationId}, 0))::text`;
      const row = await tx.visitorRegistration.findUnique({
        where: { id: dto.registrationId },
        include: { series: true },
      });
      if (
        !row ||
        row.series.purgedAt ||
        row.series.retentionAt <= new Date() ||
        !row.series.published
      )
        return null;
      if (
        !row.otpHash ||
        !row.otpExpiresAt ||
        row.otpExpiresAt <= new Date() ||
        row.otpAttempts >= 5
      )
        return null;
      await tx.visitorRegistration.update({
        where: { id: row.id },
        data: { otpAttempts: { increment: 1 } },
      });
      if (
        !timingSafeEqual(
          Buffer.from(row.otpHash),
          Buffer.from(visitorIdentityHash(dto.code)),
        )
      )
        return null;
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(
        Math.min(Date.now() + 12 * 3600000, row.series.retentionAt.getTime()),
      );
      await tx.visitorRegistration.update({
        where: { id: row.id },
        data: { verifiedAt: new Date(), otpHash: null, otpExpiresAt: null },
      });
      await tx.visitorSession.create({
        data: { visitorId: row.id, tokenHash: tokenHash(token), expiresAt },
      });
      return { token, expiresAt };
    });
    if (!result)
      throw new UnauthorizedException('Código inválido ou expirado.');
    return result;
  }
  async session(token?: string) {
    if (!token || !/^[\w-]{43}$/.test(token))
      throw new UnauthorizedException('Identifique-se como visitante.');
    const row = await this.prisma.visitorSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { visitor: { include: { series: true } } },
    });
    if (
      !row ||
      row.expiresAt <= new Date() ||
      row.visitor.series.retentionAt <= new Date() ||
      row.visitor.series.purgedAt ||
      !(row.visitor.identifiedAt || row.visitor.verifiedAt)
    )
      throw new UnauthorizedException(
        'Sua sessão expirou. Identifique-se novamente.',
      );
    return row.visitor;
  }
  async logout(token?: string) {
    if (token)
      await this.prisma.visitorSession.deleteMany({
        where: { tokenHash: tokenHash(token) },
      });
  }
  async bindCpf(token: string | undefined, value: string) {
    const visitor = await this.session(token);
    await this.limit(`bind-cpf:${visitor.id}`, 10, 600);
    const cpf = value.replace(/\D/g, '');
    if (!validCpf(cpf)) throw new BadRequestException('Informe um CPF válido.');
    const cpfHash = visitorIdentityHash(`cpf:${cpf}`);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EventSeries" WHERE "id" = ${visitor.seriesId} FOR SHARE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${visitor.seriesId + cpfHash}, 0))::text`;
      await tx.$queryRaw`SELECT "id" FROM "VisitorRegistration" WHERE "id" = ${visitor.id} FOR UPDATE`;
      const current = await tx.visitorRegistration.findUnique({
        where: { id: visitor.id },
        include: { series: true },
      });
      if (
        !current ||
        current.series.purgedAt ||
        current.series.retentionAt <= new Date()
      )
        throw new UnauthorizedException('Seu acesso expirou.');
      if (current.cpfHash && current.cpfHash !== cpfHash)
        throw new ConflictException(
          'CPF já vinculado. Procure a Secretaria para correções.',
        );
      const other = await tx.visitorRegistration.findFirst({
        where: { seriesId: visitor.seriesId, cpfHash },
      });
      if (other && other.id !== visitor.id)
        throw new ConflictException(
          'Não foi possível vincular o CPF. Procure a Secretaria.',
        );
      await tx.visitorRegistration.update({
        where: { id: visitor.id },
        data: { cpfHash },
      });
      return { success: true };
    });
  }
  async recoverCertificates(value: string, ip: string) {
    await this.limit(`certificate-recovery:${ip}`, 300, 600);
    const cpf = value.replace(/\D/g, '');
    if (!validCpf(cpf)) throw new BadRequestException('Informe um CPF válido.');
    const cpfHash = visitorIdentityHash(`cpf:${cpf}`);
    await this.limit(`certificate-identity:${cpfHash}`, 5, 600);
    const visitor = await this.prisma.visitorRegistration.findFirst({
      where: {
        cpfHash,
        series: { purgedAt: null, retentionAt: { gt: new Date() } },
      },
      include: { series: true },
      orderBy: { series: { retentionAt: 'desc' } },
    });
    if (!visitor)
      throw new UnauthorizedException(
        'Acesso não disponível. Confira o CPF ou procure a Secretaria.',
      );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Math.min(Date.now() + 3600000, visitor.series.retentionAt.getTime()),
    );
    // A recuperação nunca cria uma sessão de presença: o hash tem um domínio separado.
    await this.prisma.visitorSession.create({
      data: {
        visitorId: visitor.id,
        tokenHash: tokenHash(`certificates:${token}`),
        expiresAt,
      },
    });
    return { token, expiresAt };
  }
  async certificateVisitorIds(
    visitorToken?: string,
    certificateToken?: string,
  ) {
    if (certificateToken && /^[\w-]{43}$/.test(certificateToken)) {
      const row = await this.prisma.visitorSession.findUnique({
        where: { tokenHash: tokenHash(`certificates:${certificateToken}`) },
        include: { visitor: { include: { series: true } } },
      });
      if (
        row &&
        row.expiresAt > new Date() &&
        row.visitor.cpfHash &&
        !row.visitor.series.purgedAt &&
        row.visitor.series.retentionAt > new Date()
      ) {
        const visitors = await this.prisma.visitorRegistration.findMany({
          where: {
            cpfHash: row.visitor.cpfHash,
            series: { purgedAt: null, retentionAt: { gt: new Date() } },
          },
          select: { id: true },
        });
        return visitors.map((visitor) => visitor.id);
      }
    }
    return [(await this.session(visitorToken)).id];
  }
  async logoutCertificates(token?: string) {
    if (token)
      await this.prisma.visitorSession.deleteMany({
        where: { tokenHash: tokenHash(`certificates:${token}`) },
      });
  }
  async participant(visitorId: string, eventId: string) {
    const visitor = await this.prisma.visitorRegistration.findUnique({
      where: { id: visitorId },
      include: { series: true },
    });
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (
      !(visitor?.identifiedAt || visitor?.verifiedAt) ||
      visitor.series.purgedAt ||
      visitor.series.retentionAt <= new Date() ||
      !event?.visitorsAllowed ||
      event.seriesId !== visitor.seriesId ||
      event.status === 'CANCELLED'
    )
      throw new ForbiddenException(
        'Atividade indisponível para este visitante.',
      );
    return this.prisma.eventParticipant.upsert({
      where: { eventId_visitorId: { eventId, visitorId } },
      create: {
        eventId,
        visitorId,
        name: visitor.name,
        course: visitor.course,
      },
      update: {},
    });
  }
}
