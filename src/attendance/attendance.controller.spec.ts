import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import {
  AttendanceController,
  EventAttendanceController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';

const id = '11111111-1111-4111-8111-111111111111';
describe('Attendance HTTP authorization and DTO', () => {
  let app: INestApplication;
  let student: string;
  let secretary: string;
  const service = {
    scan: jest.fn(),
    findMine: jest.fn(),
    findByEvent: jest.fn(),
    summary: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'http-test' })],
      controllers: [AttendanceController, EventAttendanceController],
      providers: [
        AuthGuard,
        RolesGuard,
        { provide: AttendanceService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication();
    // Mesmo pipe permissivo do bootstrap atual: o scan impõe whitelist localmente.
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    const jwt = module.get(JwtService);
    student = jwt.sign({ sub: '001', accountId: 'account', role: 'student' });
    secretary = jwt.sign({ sub: 1, role: 'secretary' });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.findMine.mockResolvedValue([]);
    service.scan.mockResolvedValue({ success: true });
  });
  afterAll(async () => {
    await app.close();
  });
  it.each([
    '/attendances/me',
    `/events/${id}/attendances`,
    `/events/${id}/attendances/summary`,
  ])('requires JWT: %s', (path) =>
    request(app.getHttpServer() as Server)
      .get(path)
      .expect(401),
  );
  it('scan requires JWT', () =>
    request(app.getHttpServer() as Server)
      .post('/attendances/scan')
      .send({ qrToken: student })
      .expect(401));
  it('secretary cannot scan or query private student history', async () => {
    await request(app.getHttpServer() as Server)
      .post('/attendances/scan')
      .auth(secretary, { type: 'bearer' })
      .send({ qrToken: student })
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get('/attendances/me')
      .auth(secretary, { type: 'bearer' })
      .expect(403);
  });
  it.each(['attendances', 'attendances/summary'])(
    'student cannot inspect secretary %s',
    (path) =>
      request(app.getHttpServer() as Server)
        .get(`/events/${id}/${path}`)
        .auth(student, { type: 'bearer' })
        .expect(403),
  );
  it.each([
    {},
    { qrToken: '' },
    { qrToken: 123 },
    { qrToken: 'not-jwt' },
    { qrToken: 'a'.repeat(8193) },
  ])('rejects invalid DTO %j', (body) =>
    request(app.getHttpServer() as Server)
      .post('/attendances/scan')
      .auth(student, { type: 'bearer' })
      .send(body)
      .expect(400),
  );
  it('rejects identity spoofing in body', async () => {
    await request(app.getHttpServer() as Server)
      .post('/attendances/scan')
      .auth(student, { type: 'bearer' })
      .send({ qrToken: student, ra: 'other', accountId: 'other' })
      .expect(400);
    expect(service.scan).not.toHaveBeenCalled();
  });
  it('passes JWT identity and returns 200/no-store', async () => {
    await request(app.getHttpServer() as Server)
      .post('/attendances/scan')
      .auth(student, { type: 'bearer' })
      .send({ qrToken: student })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(service.scan).toHaveBeenCalledWith(
      student,
      expect.objectContaining({
        sub: '001',
        accountId: 'account',
        role: 'student',
      }),
    );
  });
  it('allows secretary queries and validates UUID', async () => {
    service.findByEvent.mockResolvedValue([]);
    service.summary.mockResolvedValue({
      checkedInCount: 0,
      checkedOutCount: 0,
      confirmedCount: 0,
    });
    await request(app.getHttpServer() as Server)
      .get(`/events/${id}/attendances`)
      .auth(secretary, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get(`/events/${id}/attendances/summary`)
      .auth(secretary, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/events/invalid/attendances')
      .auth(secretary, { type: 'bearer' })
      .expect(400);
  });
});
