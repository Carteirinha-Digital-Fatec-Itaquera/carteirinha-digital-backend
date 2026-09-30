import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { CheckpointType } from '@prisma/client';
import type { Server } from 'http';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CheckpointService } from './checkpoint.service';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { QrTokenService } from './qr-token.service';

describe('EventController authorization and validation', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let studentToken: string;
  let secretaryToken: string;

  const eventService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const checkpointService = {
    open: jest.fn(),
    close: jest.fn(),
    getOpen: jest.fn(),
  };

  const qrTokenService = {
    generate: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'event-http-test-secret' })],
      controllers: [EventController],
      providers: [
        AuthGuard,
        RolesGuard,
        { provide: EventService, useValue: eventService },
        { provide: CheckpointService, useValue: checkpointService },
        { provide: QrTokenService, useValue: qrTokenService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    jwt = moduleRef.get(JwtService);
    studentToken = jwt.sign({
      sub: '000123',
      role: 'student',
      accountId: 'student-account-id',
    });
    secretaryToken = jwt.sign({ sub: 7, role: 'secretary' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    eventService.create.mockResolvedValue({ id: 'event-id' });
    eventService.findAll.mockResolvedValue([]);
    checkpointService.open.mockResolvedValue({
      eventId: '11111111-1111-4111-8111-111111111111',
      type: CheckpointType.CHECK_IN,
      isOpen: true,
      version: 2,
      openedAt: '2026-10-05T19:00:00.000Z',
      closedAt: null,
    });
    checkpointService.close.mockResolvedValue({
      eventId: '11111111-1111-4111-8111-111111111111',
      type: CheckpointType.CHECK_IN,
      isOpen: false,
      version: 3,
      openedAt: '2026-10-05T19:00:00.000Z',
      closedAt: '2026-10-05T19:10:00.000Z',
    });
    checkpointService.getOpen.mockResolvedValue({
      id: 'checkpoint-id',
      eventId: '11111111-1111-4111-8111-111111111111',
      type: CheckpointType.CHECK_IN,
      isOpen: true,
      version: 2,
    });
    qrTokenService.generate.mockResolvedValue({
      qrToken: 'mock-qr-token',
      expiresInSeconds: 20,
      expiresAt: '2026-10-05T19:00:20.000Z',
      checkpointVersion: 2,
    });
  });

  it('returns 401 without authentication', () =>
    request(app.getHttpServer() as Server)
      .get('/events')
      .expect(401));

  it('returns 403 when a student tries to create an event', () =>
    request(app.getHttpServer() as Server)
      .post('/events')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        title: 'Evento teste',
        speaker: 'Palestrante',
        location: 'Auditório',
        startsAt: '2026-10-05T19:00:00.000Z',
        endsAt: '2026-10-05T21:00:00.000Z',
        workloadMinutes: 120,
      })
      .expect(403));

  it('allows secretary to create and passes authenticated creator id', async () => {
    await request(app.getHttpServer() as Server)
      .post('/events')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        title: 'Evento teste',
        speaker: 'Palestrante',
        location: 'Auditório',
        startsAt: '2026-10-05T19:00:00.000Z',
        endsAt: '2026-10-05T21:00:00.000Z',
        workloadMinutes: 120,
      })
      .expect(201);

    expect(eventService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Evento teste' }),
      7,
    );
  });

  it('returns 400 for invalid create payload', () =>
    request(app.getHttpServer() as Server)
      .post('/events')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        title: 'x',
        speaker: '',
        location: 'Auditório',
        startsAt: 'not-a-date',
        endsAt: '2026-10-05T21:00:00.000Z',
        workloadMinutes: 0,
      })
      .expect(400));

  it('lets a student list events with student role context', async () => {
    await request(app.getHttpServer() as Server)
      .get('/events?status=SCHEDULED&date=2026-10-05')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(eventService.findAll).toHaveBeenCalledWith(
      { status: 'SCHEDULED', date: '2026-10-05' },
      'student',
    );
  });

  it('returns 400 for malformed event id before service call', async () => {
    await request(app.getHttpServer() as Server)
      .get('/events/not-a-uuid')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(400);

    expect(eventService.findOne).not.toHaveBeenCalled();
  });

  it('returns 401 when opening checkpoint without authentication', () =>
    request(app.getHttpServer() as Server)
      .post(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/check-in/open',
      )
      .expect(401));

  it('returns 403 when a student tries to open a checkpoint', () =>
    request(app.getHttpServer() as Server)
      .post(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/check-in/open',
      )
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403));

  it('allows secretary to open checkpoint with valid parameters', async () => {
    await request(app.getHttpServer() as Server)
      .post(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/check-in/open',
      )
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    expect(checkpointService.open).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      CheckpointType.CHECK_IN,
    );
  });

  it('returns 400 when opening checkpoint with invalid type', async () => {
    await request(app.getHttpServer() as Server)
      .post(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/invalid-type/open',
      )
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(400);

    expect(checkpointService.open).not.toHaveBeenCalled();
  });

  it('allows secretary to close checkpoint', async () => {
    await request(app.getHttpServer() as Server)
      .post(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/check-in/close',
      )
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    expect(checkpointService.close).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      CheckpointType.CHECK_IN,
    );
  });

  it('returns 403 when student tries to get checkpoint QR', () =>
    request(app.getHttpServer() as Server)
      .get(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/check-in/qr',
      )
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403));

  it('allows secretary to get checkpoint QR and sets Cache-Control: no-store', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(
        '/events/11111111-1111-4111-8111-111111111111/checkpoints/check-in/qr',
      )
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(checkpointService.getOpen).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      CheckpointType.CHECK_IN,
    );
    expect(qrTokenService.generate).toHaveBeenCalledWith({
      eventId: '11111111-1111-4111-8111-111111111111',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 2,
      checkpointId: 'checkpoint-id',
    });
  });
});
