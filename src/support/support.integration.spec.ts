import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../database/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { SupportService } from './support.service';
import {
  SupportController,
  SupportAdminController,
} from './support.controller';
type TicketBody = {
  id: string;
  version: number;
  status: string;
  unread: boolean;
  studentName: string;
};
type DetailBody = {
  ticket: TicketBody;
  messages: { id: string; body: string }[];
};
const url = process.env.SUPPORT_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Support HTTP with isolated PostgreSQL',
  () => {
    let db: PrismaClient, app: INestApplication, jwt: JwtService;
    let student: string, other: string, admin: string, admin2: string;
    let accountId: string, adminId: number, admin2Id: number;
    const http = () => request(app.getHttpServer() as Server);
    const payload = () => ({
      requestId: randomUUID(),
      category: 'DATA',
      subject: 'Conferir informação cadastral',
      description: 'Preciso conferir a informação presente na carteirinha.',
    });
    const post = (path: string, body: object, token = student) =>
      http().post(path).auth(token, { type: 'bearer' }).send(body);
    const get = (path: string, token = student) =>
      http().get(path).auth(token, { type: 'bearer' });
    const create = async (token = student) =>
      (await post('/support/tickets', payload(), token).expect(201)).body as {
        id: string;
        version: number;
      };
    const action = (
      ticket: { id: string; version: number },
      name: string,
      extra: object = {},
    ) => ({
      requestId: randomUUID(),
      expectedVersion: ticket.version,
      ...extra,
    });
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !target.pathname.startsWith('/disposable_support_')
      )
        throw new Error(
          'Only isolated disposable_support_* localhost database accepted',
        );
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      await db.$connect();
      const module = await Test.createTestingModule({
        imports: [
          JwtModule.register({ secret: randomBytes(32).toString('hex') }),
        ],
        controllers: [SupportController, SupportAdminController],
        providers: [
          AuthGuard,
          RolesGuard,
          SecretaryActiveGuard,
          SupportService,
          { provide: PrismaService, useValue: db },
        ],
      }).compile();
      app = module.createNestApplication();
      await app.init();
      jwt = module.get(JwtService);
      for (const [index, name] of [
        'Primeira Secretaria',
        'Segunda Secretaria',
      ].entries()) {
        const row = await db.secretary.create({
          data: {
            name,
            email: randomUUID() + '@example.test',
            password: randomUUID(),
            birthDate: new Date('1990-01-01'),
            dueDate: new Date(Date.now() + 86400000),
          },
        });
        if (!index) {
          adminId = row.id;
          admin = jwt.sign({ sub: row.id, role: 'secretary' });
        } else {
          admin2Id = row.id;
          admin2 = jwt.sign({ sub: row.id, role: 'secretary' });
        }
      }
    });
    beforeEach(async () => {
      await db.supportAudit.deleteMany();
      await db.supportMessage.deleteMany();
      await db.supportTicket.deleteMany();
      const make = async () => {
        const row = await db.student.create({
          data: {
            ra: randomUUID(),
            name: 'Nome cadastral fictício',
            socialName: 'Nome de uso fictício',
            status: 'inativo',
            course: 'DSM',
            admission: '2026',
            email: randomUUID() + '@example.test',
            password: randomUUID(),
            dueDate: new Date('2020-01-01'),
          },
        });
        return {
          row,
          token: jwt.sign({
            sub: row.ra,
            accountId: row.accountId,
            role: 'student',
          }),
        };
      };
      const first = await make();
      student = first.token;
      accountId = first.row.accountId;
      other = (await make()).token;
    });
    afterAll(async () => {
      await app?.close();
      await db?.$disconnect();
    });
    it('opens for an authenticated inactive student, rejects invalid input and replays creation once', async () => {
      const data = payload();
      const first = await post('/support/tickets', data).expect(201);
      expect(
        ((await post('/support/tickets', data).expect(201)).body as TicketBody)
          .id,
      ).toBe((first.body as TicketBody).id);
      expect(await db.supportTicket.count()).toBe(1);
      await post('/support/tickets', {
        ...data,
        subject: 'Outro assunto',
      }).expect(409);
      await post('/support/tickets', {
        ...payload(),
        ownerAccountId: accountId,
      }).expect(400);
      await post('/support/tickets', {
        ...payload(),
        description: 'curta',
      }).expect(400);
      await http().get('/support/tickets/me').expect(401);
      await post('/support/tickets', payload(), admin).expect(403);
      await get('/support/admin/tickets').expect(403);
      const list = await get('/support/admin/tickets', admin).expect(200);
      expect((list.body as { items: TicketBody[] }).items[0].studentName).toBe(
        'Nome de uso fictício',
      );
      expect(JSON.stringify(list.body)).not.toContain(
        'Nome cadastral fictício',
      );
      expect(JSON.stringify(list.body)).not.toContain(data.description);
    });
    it('protects ownership, guessed ids, message cursors and RA recycling', async () => {
      const ticket = await create();
      await get('/support/tickets/' + ticket.id, other).expect(404);
      await post(
        '/support/tickets/' + ticket.id + '/read',
        { version: 999 },
        other,
      ).expect(404);
      await get('/support/tickets/me?cursor=' + ticket.id, other).expect(400);
      const previous = await db.student.findUniqueOrThrow({
        where: { accountId },
      });
      await db.student.delete({ where: { accountId } });
      await db.student.create({
        data: {
          ra: previous.ra,
          name: 'Nova pessoa',
          status: 'ativo',
          course: 'DSM',
          admission: '2026',
          email: randomUUID() + '@example.test',
          password: randomUUID(),
          dueDate: new Date(),
        },
      });
      await get('/support/tickets/' + ticket.id).expect(401);
      const replacement = await db.student.findUniqueOrThrow({
        where: { ra: previous.ra },
      });
      const token = jwt.sign({
        sub: replacement.ra,
        accountId: replacement.accountId,
        role: 'student',
      });
      expect(
        (
          (await get('/support/tickets/me', token)).body as {
            items: TicketBody[];
          }
        ).items,
      ).toEqual([]);
      await get('/support/admin/tickets/' + ticket.id, admin).expect(200);
    });
    it('serializes claims and rejects stale replies, unauthorized resolution and missing confirmation', async () => {
      const ticket = await create();
      const results = await Promise.all([
        post(
          '/support/admin/tickets/' + ticket.id + '/claim',
          action(ticket, 'claim'),
          admin,
        ),
        post(
          '/support/admin/tickets/' + ticket.id + '/claim',
          action(ticket, 'claim'),
          admin2,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const row = await db.supportTicket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      const owner = row.assignedSecretaryId === adminId ? admin : admin2;
      const notOwner = owner === admin ? admin2 : admin;
      await post(
        '/support/admin/tickets/' + ticket.id + '/messages',
        action(row, 'messages', { message: 'Resposta' }),
        notOwner,
      ).expect(409);
      await post(
        '/support/admin/tickets/' + ticket.id + '/status',
        action(row, 'status', {
          status: 'RESOLVED',
          message: 'Cadastro conferido.',
        }),
        owner,
      ).expect(400);
      await post(
        '/support/tickets/' + ticket.id + '/messages',
        action(ticket, 'message', { message: 'Mensagem com versão antiga' }),
      ).expect(409);
    });
    it('handles replies, waiting, unread state, resolution, close, reopen and privacy redaction', async () => {
      let ticket = await create();
      const path = '/support/admin/tickets/' + ticket.id;
      ticket = (
        await post(path + '/claim', action(ticket, 'claim'), admin).expect(201)
      ).body as TicketBody;
      const body = action(ticket, 'status', {
        status: 'WAITING_STUDENT',
        message: 'Qual informação deve ser conferida?',
      });
      ticket = (await post(path + '/status', body, admin).expect(201))
        .body as TicketBody;
      await post(path + '/status', body, admin).expect(201);
      let detail = (await get('/support/tickets/' + ticket.id))
        .body as DetailBody;
      expect(detail.ticket.unread).toBe(true);
      await post('/support/tickets/' + ticket.id + '/read', {
        version: ticket.version,
      }).expect(201);
      expect(
        ((await get('/support/tickets/' + ticket.id)).body as DetailBody).ticket
          .unread,
      ).toBe(false);
      ticket = (
        await post(
          '/support/tickets/' + ticket.id + '/messages',
          action(ticket, 'message', { message: 'Nome de uso para conferir.' }),
        ).expect(201)
      ).body as TicketBody;
      expect(ticket.status).toBe('IN_PROGRESS');
      ticket = (
        await post(
          path + '/status',
          action(ticket, 'status', {
            status: 'RESOLVED',
            message: 'Conferência concluída no cadastro.',
            confirmed: true,
            resultReference: 'Cadastro revisado',
          }),
          admin,
        ).expect(201)
      ).body as TicketBody;
      ticket = (
        await post(
          '/support/tickets/' + ticket.id + '/close',
          action(ticket, 'close', { message: 'Solução confirmada.' }),
        ).expect(201)
      ).body as TicketBody;
      ticket = (
        await post(
          '/support/tickets/' + ticket.id + '/reopen',
          action(ticket, 'reopen', {
            message: 'Preciso de uma nova conferência.',
          }),
        ).expect(201)
      ).body as TicketBody;
      expect(ticket.status).toBe('IN_PROGRESS');
      detail = (await get('/support/tickets/' + ticket.id)).body as DetailBody;
      ticket = (
        await post(
          path + '/messages/' + detail.messages[0].id + '/redact',
          action(ticket, 'redact', { reason: 'Minimizar dados pessoais' }),
          admin,
        ).expect(201)
      ).body as TicketBody;
      expect(
        ((await get('/support/tickets/' + ticket.id)).body as DetailBody)
          .messages[0].body,
      ).toContain('removido');
      const audit = (await get(path + '/audit', admin).expect(200)).body as {
        action: string;
      }[];
      expect(JSON.stringify(audit)).not.toContain('Nome de uso para conferir.');
      expect(
        audit.some((item: { action: string }) => item.action === 'REDACT'),
      ).toBe(true);
    });
    it('filters and paginates a thousand tickets without exposing message bodies or full RA', async () => {
      await db.supportTicket.createMany({
        data: Array.from({ length: 1000 }, (_, index) => ({
          protocol: 'SUP-SCALE-' + index,
          requestId: randomUUID(),
          requestHash: randomUUID(),
          ownerIdentity: accountId,
          ownerAccountId: accountId,
          category: 'OTHER' as const,
          subject: 'Escala fictícia ' + index,
        })),
      });
      const first = (
        await get(
          '/support/admin/tickets?limit=100&category=OTHER&assignee=unassigned',
          admin,
        ).expect(200)
      ).body as {
        items: (TicketBody & { studentRa: string })[];
        nextCursor: string;
      };
      expect(first.items).toHaveLength(100);
      expect(first.items[0].studentRa).toMatch(/^\*\*\*.{4}$/);
      const next = (
        await get(
          '/support/admin/tickets?limit=100&category=OTHER&cursor=' +
            first.nextCursor,
          admin,
        ).expect(200)
      ).body as { items: TicketBody[] };
      expect(
        new Set([...first.items, ...next.items].map((item) => item.id)).size,
      ).toBe(200);
      await get('/support/admin/tickets?from=2026-02-30', admin).expect(400);
      await get('/support/admin/tickets?limit=101', admin).expect(400);
    });
    it('reassigns with reason, counts pending states and paginates messages', async () => {
      let ticket = await create();
      const path = '/support/admin/tickets/' + ticket.id;
      ticket = (
        await post(path + '/claim', action(ticket, 'claim'), admin).expect(201)
      ).body as TicketBody;
      await http()
        .patch(path + '/assignee')
        .auth(admin, { type: 'bearer' })
        .send(action(ticket, 'assign', { assigneeId: admin2Id }))
        .expect(400);
      ticket = (
        await http()
          .patch(path + '/assignee')
          .auth(admin, { type: 'bearer' })
          .send(
            action(ticket, 'assign', {
              assigneeId: admin2Id,
              reason: 'Encaminhar atendimento à outra equipe.',
            }),
          )
          .expect(200)
      ).body as TicketBody;
      const body = action(ticket, 'reply', {
        message: 'Qual informação precisa ser conferida?',
      });
      ticket = (await post(path + '/messages', body, admin2).expect(201))
        .body as TicketBody;
      await post(path + '/messages', body, admin2).expect(201);
      expect(
        await db.supportMessage.count({ where: { ticketId: ticket.id } }),
      ).toBe(2);
      ticket = (
        await post(
          path + '/status',
          action(ticket, 'waiting', {
            status: 'WAITING_STUDENT',
            message: 'Aguardando confirmação do aluno.',
          }),
          admin2,
        ).expect(201)
      ).body as TicketBody;
      expect(
        (
          (await get('/support/admin/summary', admin)).body as {
            pending: number;
          }
        ).pending,
      ).toBe(0);
      const latest = (await get('/support/tickets/' + ticket.id + '?limit=1'))
        .body as DetailBody & { messageNextCursor: string };
      const older = (
        await get(
          '/support/tickets/' +
            ticket.id +
            '?limit=1&cursor=' +
            latest.messageNextCursor,
        )
      ).body as DetailBody;
      expect(latest.messages[0].id).not.toBe(older.messages[0].id);
      await post('/support/tickets/' + ticket.id + '/messages', {
        ...action(ticket, 'message', { message: 'Confirmado.' }),
        authorRole: 'SECRETARY',
      }).expect(400);
    });
    it.each(['student', 'secretary'])(
      'allows %s to cancel an assigned ticket and preserves audit without claiming resolution',
      async (role) => {
        let ticket = await create();
        ticket = (
          await post(
            '/support/admin/tickets/' + ticket.id + '/claim',
            action(ticket, 'claim'),
            admin,
          ).expect(201)
        ).body as TicketBody;
        const path =
          role === 'student' ? '/support/tickets/' : '/support/admin/tickets/';
        const token = role === 'student' ? student : admin2;
        const body = action(ticket, 'cancel', {
          reason: 'Solicitação aberta por engano.',
          confirmed: true,
        });
        await post(
          path + ticket.id + '/cancel',
          { ...body, confirmed: false },
          token,
        ).expect(400);
        await post(path + ticket.id + '/cancel', body, token).expect(201);
        await post(path + ticket.id + '/cancel', body, token).expect(201);
        const saved = await db.supportTicket.findUniqueOrThrow({
          where: { id: ticket.id },
        });
        expect(saved.status).toBe('CLOSED');
        expect(saved.resolvedAt).toBeNull();
        expect(saved.closeReason).toBe('CANCELLED_BY_' + role.toUpperCase());
        expect(
          await db.supportAudit.count({
            where: { ticketId: ticket.id, action: 'CANCEL' },
          }),
        ).toBe(1);
        expect(
          (
            (await get('/support/admin/summary', admin)).body as {
              pending: number;
            }
          ).pending,
        ).toBe(0);
      },
    );
    it.each(['student', 'secretary'])(
      'allows %s to delete a ticket from both flows while retaining its audit',
      async (role) => {
        const ticket = await create();
        const path =
          role === 'student' ? '/support/tickets/' : '/support/admin/tickets/';
        const token = role === 'student' ? student : admin;
        const body = action(ticket, 'delete', {
          reason: 'Registro duplicado por engano.',
          confirmed: true,
        });
        await post(
          '/support/tickets/' + ticket.id + '/delete',
          body,
          other,
        ).expect(404);
        await post(
          path + ticket.id + '/delete',
          { ...body, expectedVersion: 99 },
          token,
        ).expect(409);
        await post(path + ticket.id + '/delete', body, token).expect(201);
        await post(path + ticket.id + '/delete', body, token).expect(201);
        await get('/support/tickets/' + ticket.id).expect(404);
        await get('/support/admin/tickets/' + ticket.id, admin).expect(404);
        expect(
          ((await get('/support/tickets/me')).body as { items: TicketBody[] })
            .items,
        ).toEqual([]);
        expect(
          (
            (await get('/support/admin/tickets', admin)).body as {
              items: TicketBody[];
            }
          ).items,
        ).toEqual([]);
        expect(
          (
            (await get('/support/admin/summary', admin)).body as {
              pending: number;
            }
          ).pending,
        ).toBe(0);
        expect(
          (
            await db.supportTicket.findUniqueOrThrow({
              where: { id: ticket.id },
            })
          ).deletedAt,
        ).not.toBeNull();
        expect(
          await db.supportAudit.count({
            where: { ticketId: ticket.id, action: 'DELETE' },
          }),
        ).toBe(1);
        expect(
          await db.supportMessage.count({ where: { ticketId: ticket.id } }),
        ).toBe(1);
        await post(
          '/support/tickets/' + ticket.id + '/reopen',
          action(ticket, 'reopen', { message: 'Reabrir removido.' }),
        ).expect(404);
        await post('/support/tickets/' + ticket.id + '/read', {
          version: 1,
        }).expect(404);
        await get('/support/admin/tickets?cursor=' + ticket.id, admin).expect(
          400,
        );
      },
    );
    it('enforces opening and reply rate limits with idempotent replay', async () => {
      const first = await create();
      for (let i = 0; i < 4; i++) await create();
      await post('/support/tickets', payload()).expect(429);
      let ticket = first;
      for (let i = 0; i < 25; i++)
        ticket = (
          await post(
            '/support/tickets/' + ticket.id + '/messages',
            action(ticket, 'message', { message: 'Resposta fictícia ' + i }),
          ).expect(201)
        ).body as TicketBody;
      await post(
        '/support/tickets/' + ticket.id + '/messages',
        action(ticket, 'message', { message: 'Limite' }),
      ).expect(429);
    });
    it('rejects unrelated certificates, expired staff and reopening outside seven days', async () => {
      await post('/support/tickets', {
        ...payload(),
        certificateId: randomUUID(),
      }).expect(400);
      let ticket = await create();
      ticket = (
        await post(
          '/support/tickets/' + ticket.id + '/close',
          action(ticket, 'close', { message: 'Não é mais necessário.' }),
        ).expect(201)
      ).body as TicketBody;
      await db.supportTicket.update({
        where: { id: ticket.id },
        data: { closedAt: new Date(Date.now() - 8 * 86400000) },
      });
      await post(
        '/support/tickets/' + ticket.id + '/reopen',
        action(ticket, 'reopen', { message: 'Reabrir após prazo.' }),
      ).expect(409);
      await db.secretary.update({
        where: { id: admin2Id },
        data: { dueDate: new Date(0) },
      });
      await get('/support/admin/summary', admin2).expect(403);
      await db.secretary.update({
        where: { id: admin2Id },
        data: { dueDate: new Date(Date.now() + 86400000) },
      });
    });
  },
);
