import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
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
  async register(dto: RegisterVisitorDto, ip: string) {
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
    await this.limit(`contact:${emailHash}`, 15, 86400);
    const cpf = dto.cpf?.replace(/\D/g, '');
    if (series.cpfRequired && (!cpf || !validCpf(cpf)))
      throw new BadRequestException('CPF válido obrigatório para esta edição.');
    if (dto.cpf && !series.cpfRequired)
      throw new BadRequestException('Esta edição não solicita CPF.');
    const cpfHash = cpf ? visitorIdentityHash(`cpf:${cpf}`) : null;
    const code = String(randomInt(100000, 1000000));
    const registration = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { purgedAt: Date | null; retentionAt: Date }[]
      >`SELECT "purgedAt", "retentionAt" FROM "EventSeries" WHERE "id" = ${dto.seriesId} FOR SHARE`;
      if (!locked || locked.purgedAt || locked.retentionAt <= new Date())
        throw new NotFoundException('Inscrições encerradas.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.seriesId + emailHash}, 0))::text`;
      if (cpfHash)
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.seriesId + cpfHash}, 0))::text`;
      const existing = await tx.visitorRegistration.findUnique({
        where: { seriesId_emailHash: { seriesId: dto.seriesId, emailHash } },
      });
      if (
        existing?.lastChallengeAt &&
        Date.now() - existing.lastChallengeAt.getTime() < 60000
      )
        throw new HttpException(
          'Aguarde um minuto para solicitar outro código.',
          429,
        );
      // O contato confirmado não pode ter seu nome alterado por uma inscrição não autenticada.
      if (
        cpfHash &&
        (await tx.visitorRegistration.findFirst({
          where: {
            seriesId: dto.seriesId,
            cpfHash,
            emailHash: { not: emailHash },
          },
        }))
      )
        throw new BadRequestException(
          'Não foi possível concluir. Procure a Secretaria para conferir os dados.',
        );
      return tx.visitorRegistration.upsert({
        where: { seriesId_emailHash: { seriesId: dto.seriesId, emailHash } },
        create: {
          seriesId: dto.seriesId,
          name: dto.name.trim(),
          course: dto.course || null,
          email,
          emailHash,
          cpfHash,
          otpHash: visitorIdentityHash(code),
          otpExpiresAt: new Date(Date.now() + 600000),
          lastChallengeAt: new Date(),
        },
        update: {
          otpHash: visitorIdentityHash(code),
          otpExpiresAt: new Date(Date.now() + 600000),
          otpAttempts: 0,
          lastChallengeAt: new Date(),
        },
      });
    });
    try {
      await this.mail.sendVisitorCode(email, code);
    } catch {
      await this.prisma.visitorRegistration.updateMany({
        where: { id: registration.id, otpHash: visitorIdentityHash(code) },
        data: { otpHash: null, otpExpiresAt: null },
      });
      throw new ServiceUnavailableException(
        'Não foi possível enviar o código. Tente novamente em um minuto.',
      );
    }
    return {
      registrationId: registration.id,
      message: 'Enviamos um código para o e-mail informado.',
    };
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
        !row?.otpHash ||
        !row.otpExpiresAt ||
        row.otpExpiresAt <= new Date() ||
        row.otpAttempts >= 5 ||
        row.series.purgedAt ||
        row.series.retentionAt <= new Date() ||
        !row.series.published
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
      !row.visitor.verifiedAt
    )
      throw new UnauthorizedException(
        'Sua sessão expirou. Confirme seu e-mail novamente.',
      );
    return row.visitor;
  }
  async logout(token?: string) {
    if (token)
      await this.prisma.visitorSession.deleteMany({
        where: { tokenHash: tokenHash(token) },
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
      !visitor?.verifiedAt ||
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
