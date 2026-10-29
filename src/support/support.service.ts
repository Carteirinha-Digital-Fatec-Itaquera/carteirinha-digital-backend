import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, SupportCategory, SupportStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import type { TokenPayload } from '../auth/dto/payload.dto';
import type {
  SupportActionDto,
  SupportCreateDto,
  SupportQueryDto,
} from './support.dto';

const summarySelect = {
  id: true,
  protocol: true,
  category: true,
  subject: true,
  status: true,
  assignedSecretaryId: true,
  version: true,
  studentReadVersion: true,
  secretaryReadVersion: true,
  lastActorRole: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
  closeReason: true,
  eventId: true,
  certificateId: true,
  owner: { select: { ra: true, name: true, socialName: true, course: true } },
  assignee: { select: { id: true, name: true, dueDate: true } },
} satisfies Prisma.SupportTicketSelect;
type Summary = Prisma.SupportTicketGetPayload<{ select: typeof summarySelect }>;
type Actor = { role: 'STUDENT' | 'SECRETARY'; id: string };
type Action =
  | 'MESSAGE'
  | 'CLAIM'
  | 'ASSIGNEE'
  | 'STATUS'
  | 'CLOSE'
  | 'REOPEN'
  | 'REDACT'
  | 'CANCEL'
  | 'DELETE';
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: string | undefined, min: number, max: number) => {
  const result = value?.trim() || '';
  if (
    result.length < min ||
    result.length > max ||
    Array.from(result).some(
      (c) => c.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(c),
    )
  )
    throw new BadRequestException(
      'Informe um texto válido dentro do limite indicado.',
    );
  return result;
};

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  private async actor(
    tx: Prisma.TransactionClient,
    user: TokenPayload,
    admin = false,
  ): Promise<Actor> {
    if (admin && user.role !== 'secretary')
      throw new ForbiddenException('Acesso restrito à Secretaria.');
    if (
      user.role === 'student' &&
      typeof user.sub === 'string' &&
      user.accountId
    ) {
      const rows = await tx.$queryRaw<
        { accountId: string }[]
      >`SELECT "accountId" FROM "Student" WHERE "ra" = ${user.sub} FOR SHARE`;
      if (rows[0]?.accountId !== user.accountId)
        throw new UnauthorizedException(
          'Conta original indisponível. Entre novamente ou procure a instituição.',
        );
      return { role: 'STUDENT', id: user.accountId };
    }
    if (user.role === 'secretary' && typeof user.sub === 'number') {
      const rows = await tx.$queryRaw<
        { dueDate: Date }[]
      >`SELECT "dueDate" FROM "Secretary" WHERE "id" = ${user.sub} FOR SHARE`;
      if (!rows[0] || rows[0].dueDate < new Date())
        throw new ForbiddenException(
          'Conta da Secretaria indisponível ou com renovação pendente.',
        );
      return { role: 'SECRETARY', id: String(user.sub) };
    }
    throw new UnauthorizedException('Sessão inválida.');
  }

  private scope(actor: Actor): Prisma.SupportTicketWhereInput {
    return actor.role === 'STUDENT'
      ? { ownerIdentity: actor.id, ownerAccountId: actor.id }
      : {};
  }
  private present(ticket: Summary, actor: Actor) {
    const {
      owner,
      assignee,
      studentReadVersion,
      secretaryReadVersion,
      ...rest
    } = ticket;
    return {
      ...rest,
      unread:
        (actor.role === 'STUDENT' ? studentReadVersion : secretaryReadVersion) <
        ticket.version,
      ...(actor.role === 'SECRETARY'
        ? {
            studentRa: owner?.ra ?? null,
            studentName:
              owner?.socialName || owner?.name || 'Conta indisponível',
            studentCourse: owner?.course ?? null,
            assigneeName: assignee?.name ?? null,
            assigneeAvailable: Boolean(
              assignee && assignee.dueDate >= new Date(),
            ),
          }
        : {}),
    };
  }

  async create(user: TokenPayload, dto: SupportCreateDto) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.actor(tx, user);
      if (actor.role !== 'STUDENT')
        throw new ForbiddenException(
          'Abertura disponível ao aluno autenticado.',
        );
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-create:${actor.id}`}, 0))::text`;
      const subject = text(dto.subject, 5, 120),
        description = text(dto.description, 20, 3000);
      const fingerprint = hash([
        dto.category,
        subject,
        description,
        dto.requestedField || null,
        dto.proposedValue || null,
        dto.eventId || null,
        dto.certificateId || null,
      ]);
      const previous = await tx.supportTicket.findUnique({
        where: {
          ownerIdentity_requestId: {
            ownerIdentity: actor.id,
            requestId: dto.requestId,
          },
        },
        select: { ...summarySelect, requestHash: true },
      });
      if (previous) {
        if (previous.requestHash !== fingerprint)
          throw new ConflictException(
            'Esta tentativa já foi utilizada com outro conteúdo.',
          );
        return this.present(previous, actor);
      }
      if (
        (await tx.supportTicket.count({
          where: {
            ownerIdentity: actor.id,
            createdAt: { gte: new Date(Date.now() - 3600000) },
          },
        })) >= 5
      )
        throw new HttpException(
          'Limite de solicitações por hora atingido. Aguarde antes de abrir outra.',
          429,
        );
      let eventId = dto.eventId;
      if (dto.certificateId) {
        const certificate = await tx.certificate.findFirst({
          where: { id: dto.certificateId, studentAccountId: actor.id },
          select: { eventId: true },
        });
        if (!certificate || (eventId && eventId !== certificate.eventId))
          throw new BadRequestException(
            'Certificado não pertence à sua conta ou ao evento informado.',
          );
        eventId = certificate.eventId;
      }
      if (eventId) {
        const event = await tx.event.findUnique({
          where: { id: eventId },
          select: { status: true },
        });
        if (
          !event ||
          (event.status === 'CANCELLED' &&
            !(await tx.attendance.count({
              where: { eventId, studentAccountId: actor.id },
            })))
        )
          throw new BadRequestException(
            'Evento indisponível para esta solicitação.',
          );
      }
      if ((dto.requestedField || dto.proposedValue) && dto.category !== 'DATA')
        throw new BadRequestException(
          'Dado desejado deve ser informado na categoria Dados cadastrais.',
        );
      const id = randomUUID();
      let inserted = false;
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        const result = await tx.supportTicket.createMany({
          data: [
            {
              id,
              protocol: `SUP-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`,
              requestId: dto.requestId,
              requestHash: fingerprint,
              ownerIdentity: actor.id,
              ownerAccountId: actor.id,
              category: dto.category as SupportCategory,
              subject,
              requestedField: dto.requestedField,
              proposedValue: dto.proposedValue?.trim(),
              eventId,
              certificateId: dto.certificateId,
            },
          ],
          skipDuplicates: true,
        });
        inserted = result.count === 1;
      }
      if (!inserted)
        throw new ConflictException(
          'Não foi possível gerar protocolo. Tente novamente.',
        );
      await tx.supportMessage.create({
        data: {
          ticketId: id,
          clientMessageId: dto.requestId,
          authorRole: actor.role,
          authorIdentity: actor.id,
          body: description,
        },
      });
      await tx.supportAudit.create({
        data: {
          ticketId: id,
          requestId: dto.requestId,
          requestHash: fingerprint,
          action: 'CREATED',
          actorRole: actor.role,
          actorIdentity: actor.id,
          nextStatus: 'OPEN',
        },
      });
      return this.present(
        await tx.supportTicket.findUniqueOrThrow({
          where: { id },
          select: summarySelect,
        }),
        actor,
      );
    });
  }

  async list(user: TokenPayload, query: SupportQueryDto, admin = false) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.actor(tx, user, admin);
      const where: Prisma.SupportTicketWhereInput = {
        deletedAt: null,
        ...this.scope(actor),
        ...(query.status ? { status: query.status as SupportStatus } : {}),
        ...(query.category
          ? { category: query.category as SupportCategory }
          : {}),
      };
      if (admin && query.assignee === 'mine')
        where.assignedSecretaryId = Number(actor.id);
      if (admin && query.assignee === 'unassigned')
        where.assignedSecretaryId = null;
      if (query.q)
        where.OR = [
          { protocol: { contains: query.q, mode: 'insensitive' } },
          { subject: { contains: query.q, mode: 'insensitive' } },
          ...(admin
            ? [
                {
                  owner: {
                    is: {
                      OR: [
                        { ra: { contains: query.q } },
                        {
                          name: {
                            contains: query.q,
                            mode: 'insensitive' as const,
                          },
                        },
                        {
                          socialName: {
                            contains: query.q,
                            mode: 'insensitive' as const,
                          },
                        },
                      ],
                    },
                  },
                },
              ]
            : []),
        ];
      if (query.from || query.to) {
        const from = query.from
          ? new Date(`${query.from}T00:00:00-03:00`)
          : undefined;
        const to = query.to
          ? new Date(
              new Date(`${query.to}T00:00:00-03:00`).getTime() + 86400000,
            )
          : undefined;
        if (
          (from && !Number.isFinite(from.getTime())) ||
          (to && !Number.isFinite(to.getTime())) ||
          (from && to && from >= to)
        )
          throw new BadRequestException('Período inválido.');
        where.createdAt = { gte: from, lt: to };
      }
      if (
        query.cursor &&
        !(await tx.supportTicket.count({
          where: { id: query.cursor, deletedAt: null, ...this.scope(actor) },
        }))
      )
        throw new BadRequestException('Página indisponível. Atualize a lista.');
      const limit = query.limit ?? 20;
      const rows = await tx.supportTicket.findMany({
        where,
        select: summarySelect,
        orderBy: [{ createdAt: admin ? 'asc' : 'desc' }, { id: 'asc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      return {
        items: rows.slice(0, limit).map((row) => {
          const item = this.present(row, actor);
          return admin && 'studentRa' in item
            ? {
                ...item,
                studentRa: item.studentRa
                  ? '***' + item.studentRa.slice(-4)
                  : null,
              }
            : item;
        }),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
  }

  async detail(
    user: TokenPayload,
    id: string,
    query: SupportQueryDto,
    admin = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.actor(tx, user, admin);
      const ticket = await tx.supportTicket.findFirst({
        where: { id, deletedAt: null, ...this.scope(actor) },
        select: { ...summarySelect, requestedField: true, proposedValue: true },
      });
      if (!ticket) throw new NotFoundException('Solicitação não encontrada.');
      if (
        query.cursor &&
        !(await tx.supportMessage.count({
          where: { id: query.cursor, ticketId: id },
        }))
      )
        throw new BadRequestException('Página de mensagens indisponível.');
      const limit = query.limit ?? 50;
      const messages = await tx.supportMessage.findMany({
        where: { ticketId: id },
        select: {
          id: true,
          authorRole: true,
          body: true,
          redactedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      return {
        ticket: {
          ...this.present(ticket, actor),
          requestedField: ticket.requestedField,
          proposedValue: ticket.proposedValue,
        },
        messages: messages.slice(0, limit).reverse(),
        messageNextCursor:
          messages.length > limit ? messages[limit - 1].id : null,
        ...(admin ? { viewerSecretaryId: Number(actor.id) } : {}),
      };
    });
  }

  async summary(user: TokenPayload) {
    return this.prisma.$transaction(async (tx) => {
      await this.actor(tx, user, true);
      const pending = await tx.supportTicket.count({
        where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      });
      return { pending };
    });
  }
  async assignees(user: TokenPayload) {
    return this.prisma.$transaction(async (tx) => {
      await this.actor(tx, user, true);
      return tx.secretary.findMany({
        where: { dueDate: { gte: new Date() } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    });
  }
  async audit(user: TokenPayload, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.actor(tx, user, true);
      if (!(await tx.supportTicket.count({ where: { id } })))
        throw new NotFoundException('Solicitação não encontrada.');
      return tx.supportAudit.findMany({
        where: { ticketId: id },
        select: {
          id: true,
          action: true,
          actorRole: true,
          actorIdentity: true,
          previousStatus: true,
          nextStatus: true,
          previousAssigneeId: true,
          nextAssigneeId: true,
          reason: true,
          resultReference: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      });
    });
  }
  async read(user: TokenPayload, id: string, version: number, admin = false) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.actor(tx, user, admin);
      const ticket = await tx.supportTicket.findFirst({
        where: { id, deletedAt: null, ...this.scope(actor) },
        select: { version: true },
      });
      if (!ticket) throw new NotFoundException('Solicitação não encontrada.');
      const seen = Math.min(version, ticket.version);
      if (actor.role === 'STUDENT')
        await tx.supportTicket.updateMany({
          where: { id, studentReadVersion: { lt: seen } },
          data: { studentReadVersion: seen },
        });
      else
        await tx.supportTicket.updateMany({
          where: { id, secretaryReadVersion: { lt: seen } },
          data: { secretaryReadVersion: seen },
        });
      return { success: true };
    });
  }

  async act(
    user: TokenPayload,
    id: string,
    action: Action,
    dto: SupportActionDto,
    admin = false,
    messageId?: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.actor(tx, user, admin);
        await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
        const ticket = await tx.supportTicket.findFirst({
          where: { id, ...this.scope(actor) },
        });
        if (!ticket || (ticket.deletedAt && action !== 'DELETE'))
          throw new NotFoundException('Solicitação não encontrada.');
        const fingerprint = hash([
          action,
          actor.id,
          dto.message?.trim() || null,
          dto.reason?.trim() || null,
          dto.status || null,
          dto.assigneeId || null,
          dto.resultReference || null,
          dto.confirmed || false,
          messageId || null,
        ]);
        const replay = await tx.supportAudit.findUnique({
          where: {
            ticketId_requestId: { ticketId: id, requestId: dto.requestId },
          },
        });
        if (replay) {
          if (replay.requestHash !== fingerprint)
            throw new ConflictException(
              'Tentativa já utilizada com outro conteúdo.',
            );
          return this.present(
            await tx.supportTicket.findUniqueOrThrow({
              where: { id },
              select: summarySelect,
            }),
            actor,
          );
        }
        if (ticket.deletedAt)
          throw new NotFoundException('Solicitação não encontrada.');
        if (ticket.version !== dto.expectedVersion)
          throw new ConflictException(
            'Solicitação alterada por outro atendimento. Atualize antes de continuar.',
          );
        const terminal = ['RESOLVED', 'CLOSED'].includes(ticket.status);
        let status = ticket.status,
          assigneeId = ticket.assignedSecretaryId;
        const data: Prisma.SupportTicketUncheckedUpdateInput = {};
        let body: string | null = null;
        if (action === 'MESSAGE') {
          if (terminal)
            throw new ConflictException(
              'Reabra a solicitação antes de responder.',
            );
          body = text(dto.message, 1, 3000);
          if (actor.role === 'SECRETARY' && assigneeId !== Number(actor.id))
            throw new ConflictException(
              'Assuma o atendimento antes de responder.',
            );
          if (actor.role === 'STUDENT' && status === 'WAITING_STUDENT')
            status = assigneeId ? 'IN_PROGRESS' : 'OPEN';
        } else if (action === 'CLAIM') {
          if (actor.role !== 'SECRETARY' || terminal || assigneeId !== null)
            throw new ConflictException(
              'Atendimento indisponível para assumir. Use reatribuição com justificativa.',
            );
          assigneeId = Number(actor.id);
          status = 'IN_PROGRESS';
        } else if (action === 'ASSIGNEE') {
          if (actor.role !== 'SECRETARY' || terminal || !dto.assigneeId)
            throw new BadRequestException(
              'Informe responsável para solicitação aberta.',
            );
          text(dto.reason, 3, 1000);
          const target = await tx.secretary.findUnique({
            where: { id: dto.assigneeId },
            select: { dueDate: true },
          });
          if (!target || target.dueDate < new Date())
            throw new BadRequestException('Responsável indisponível.');
          assigneeId = dto.assigneeId;
          if (status === 'OPEN') status = 'IN_PROGRESS';
        } else if (action === 'STATUS') {
          if (
            actor.role !== 'SECRETARY' ||
            terminal ||
            assigneeId !== Number(actor.id)
          )
            throw new ConflictException(
              'Assuma o atendimento para alterar a situação.',
            );
          body = text(dto.message, 1, 3000);
          if (dto.status === 'RESOLVED' && dto.confirmed === true) {
            status = 'RESOLVED';
            data.resolvedAt = new Date();
          } else if (
            dto.status === 'WAITING_STUDENT' &&
            status === 'IN_PROGRESS'
          )
            status = 'WAITING_STUDENT';
          else if (dto.status === 'IN_PROGRESS' && status === 'WAITING_STUDENT')
            status = 'IN_PROGRESS';
          else
            throw new BadRequestException(
              'Transição inválida ou confirmação da solução pendente.',
            );
        } else if (action === 'CANCEL' || action === 'DELETE') {
          if (dto.confirmed !== true)
            throw new BadRequestException(
              'Confirme a ação antes de continuar.',
            );
          if (action === 'CANCEL' && terminal)
            throw new ConflictException('Solicitação já finalizada.');
          text(dto.reason, 3, 1000);
          status = 'CLOSED';
          data.closedAt = new Date();
          data.resolvedAt = null;
          data.closeReason = `${action === 'CANCEL' ? 'CANCELLED' : 'DELETED'}_BY_${actor.role}`;
          if (action === 'DELETE') data.deletedAt = new Date();
        } else if (action === 'CLOSE') {
          if (
            actor.role !== 'STUDENT' ||
            !['OPEN', 'RESOLVED'].includes(status) ||
            (status === 'OPEN' && assigneeId !== null)
          )
            throw new ConflictException(
              'Converse com a Secretaria antes de encerrar.',
            );
          body = text(dto.message, 1, 3000);
          data.closeReason =
            status === 'OPEN' ? 'CANCELLED_BY_STUDENT' : 'RESOLUTION_ACCEPTED';
          status = 'CLOSED';
          data.closedAt = new Date();
        } else if (action === 'REOPEN') {
          const base = ticket.resolvedAt ?? ticket.closedAt;
          if (
            actor.role !== 'STUDENT' ||
            !terminal ||
            !base ||
            Date.now() - base.getTime() > 7 * 86400000
          )
            throw new ConflictException(
              'Reabertura indisponível. Abra uma nova solicitação, se necessário.',
            );
          body = text(dto.message, 3, 3000);
          status = assigneeId ? 'IN_PROGRESS' : 'OPEN';
          data.resolvedAt = null;
          data.closedAt = null;
          data.closeReason = null;
        } else if (action === 'REDACT') {
          if (actor.role !== 'SECRETARY' || assigneeId !== Number(actor.id))
            throw new ForbiddenException(
              'Apenas o responsável pode remover conteúdo sensível.',
            );
          text(dto.reason, 3, 1000);
          const message = await tx.supportMessage.findFirst({
            where: { id: messageId, ticketId: id },
          });
          if (!message) throw new NotFoundException('Mensagem não encontrada.');
          await tx.supportMessage.update({
            where: { id: message.id },
            data: {
              body: '[Conteúdo removido por privacidade]',
              redactedAt: new Date(),
            },
          });
        }
        if (body) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-message:${actor.role}:${actor.id}`}, 0))::text`;
          const count = await tx.supportMessage.count({
            where: {
              authorIdentity: actor.id,
              authorRole: actor.role,
              createdAt: { gte: new Date(Date.now() - 3600000) },
            },
          });
          if (count >= (actor.role === 'STUDENT' ? 30 : 300))
            throw new HttpException(
              'Limite de mensagens por hora atingido. Aguarde e tente novamente.',
              429,
            );
          await tx.supportMessage.create({
            data: {
              ticketId: id,
              clientMessageId: dto.requestId,
              authorRole: actor.role,
              authorIdentity: actor.id,
              body,
            },
          });
        }
        const updated = await tx.supportTicket.updateMany({
          where: { id, version: dto.expectedVersion },
          data: {
            ...data,
            status,
            assignedSecretaryId: assigneeId,
            version: { increment: 1 },
            lastActorRole: actor.role,
            ...(actor.role === 'STUDENT'
              ? { studentReadVersion: ticket.version + 1 }
              : { secretaryReadVersion: ticket.version + 1 }),
          },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            'Solicitação mudou. Atualize para continuar.',
          );
        await tx.supportAudit.create({
          data: {
            ticketId: id,
            requestId: dto.requestId,
            requestHash: fingerprint,
            action,
            actorRole: actor.role,
            actorIdentity: actor.id,
            previousStatus: ticket.status,
            nextStatus: status,
            previousAssigneeId: ticket.assignedSecretaryId,
            nextAssigneeId: assigneeId,
            reason: dto.reason,
            resultReference: dto.resultReference,
          },
        });
        return this.present(
          await tx.supportTicket.findUniqueOrThrow({
            where: { id },
            select: summarySelect,
          }),
          actor,
        );
      },
      { timeout: 15000 },
    );
  }
}
