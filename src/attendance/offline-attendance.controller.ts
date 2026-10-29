import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { OfflineAttendanceService } from './offline-attendance.service';
import {
  OfflineStatusDto,
  OfflineSubmitDto,
} from './dto/offline-attendance.dto';

const COOKIE = 'event_student_offline';
const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
function cookie(req: Request) {
  return req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1);
}
function origin(req: Request) {
  const value = req.headers.origin;
  const allowed = new URL(
    process.env.STUDENT_APP_URL ||
      'https://carteirinha-digital-front-end-aluno.vercel.app',
  ).origin;
  if (
    !value ||
    (value !== allowed &&
      !(
        process.env.NODE_ENV !== 'production' &&
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(value)
      ))
  )
    throw new ForbiddenException({
      code: 'ORIGIN_MISMATCH',
      message: 'Origem de acesso inválida.',
    });
  return value;
}
function options(value: string): CookieOptions {
  return {
    httpOnly: true,
    secure: value.startsWith('https://'),
    sameSite: 'strict',
    path: '/api/attendances/offline',
  };
}

@Controller('attendances/offline')
export class OfflineAttendanceController {
  constructor(private readonly offline: OfflineAttendanceService) {}
  @Post('session')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthGuard)
  async prepare(
    @Req() req: Request & { user: TokenPayload & { exp?: number } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const source = origin(req);
    const session = await this.offline.prepare(req.user, source, cookie(req));
    res.cookie(COOKIE, session.token, {
      ...options(source),
      expires: new Date(session.expiresAt),
    });
    return { accountId: session.accountId, expiresAt: session.expiresAt };
  }
  @Post('submit')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Req() req: Request, @Body(validation) dto: OfflineSubmitDto) {
    return this.offline.submit(cookie(req), origin(req), dto);
  }
  @Post('status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  status(@Req() req: Request, @Body(validation) dto: OfflineStatusDto) {
    return this.offline.status(cookie(req), origin(req), dto);
  }
  @Post('revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const source = origin(req);
    const result = await this.offline.revoke(cookie(req), source);
    res.clearCookie(COOKIE, options(source));
    return result;
  }
}
