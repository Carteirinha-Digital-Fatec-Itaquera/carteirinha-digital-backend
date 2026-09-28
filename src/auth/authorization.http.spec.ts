import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from './auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('auth-probe')
@UseGuards(AuthGuard, RolesGuard)
class AuthProbeController {
  @Get('student')
  @Roles('student')
  student() {
    return { ok: true };
  }

  @Get('secretary')
  @Roles('secretary')
  secretary() {
    return { ok: true };
  }
}

describe('AuthGuard + RolesGuard HTTP behavior', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let studentToken: string;
  let secretaryToken: string;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-jwt-secret' })],
      controllers: [AuthProbeController],
      providers: [AuthGuard, RolesGuard],
    }).compile();

    app = moduleRef.createNestApplication();
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

  it('returns 401 without bearer token', () =>
    request(app.getHttpServer()).get('/auth-probe/student').expect(401));

  it('returns 403 when student calls secretary route', () =>
    request(app.getHttpServer())
      .get('/auth-probe/secretary')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403));
  it('returns 403 when secretary calls student route', () =>
    request(app.getHttpServer())
      .get('/auth-probe/student')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(403));

  it('allows the matching role', async () => {
    await request(app.getHttpServer())
      .get('/auth-probe/student')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth-probe/secretary')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);
  });
});
