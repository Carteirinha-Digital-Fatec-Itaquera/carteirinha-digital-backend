import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { EventController } from './event.controller';
import { EventService } from './event.service';

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'event-http-test-secret' })],
      controllers: [EventController],
      providers: [
        AuthGuard,
        RolesGuard,
        { provide: EventService, useValue: eventService },
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
  });

  it('returns 401 without authentication', () =>
    request(app.getHttpServer()).get('/events').expect(401));

  it('returns 403 when a student tries to create an event', () =>
    request(app.getHttpServer())
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
    await request(app.getHttpServer())
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
    request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .get('/events?status=SCHEDULED&date=2026-10-05')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(eventService.findAll).toHaveBeenCalledWith(
      { status: 'SCHEDULED', date: '2026-10-05' },
      'student',
    );
  });
  it('returns 400 for malformed event id before service call', async () => {
    await request(app.getHttpServer())
      .get('/events/not-a-uuid')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(400);

    expect(eventService.findOne).not.toHaveBeenCalled();
  });
});
