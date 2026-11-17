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
import type { CookieOptions, Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { TokenPayload } from '../auth/dto/payload.dto';
import {
  OfflineStatusDto,
  OfflineSubmitDto,
} from './dto/offline-attendance.dto';
import { EmployeeOfflineAttendanceService } from './employee-offline-attendance.service';

const COOKIE = 'event_employee_offline';
const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});

function extractCookie(req: Request): string | undefined {
  return req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

function validateOrigin(req: Request): string {
  const value = req.headers.origin;
  const configured = process.env.EMPLOYEE_APP_URL?.trim();
  const allowedOrigin = configured ? new URL(configured).origin : null;
  const isDevLocalhost =
    process.env.NODE_ENV !== 'production' &&
    Boolean(value && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(value));

  if (!value || (value !== allowedOrigin && !isDevLocalhost)) {
    throw new ForbiddenException({
      code: 'ORIGIN_MISMATCH',
      message: 'Origem de acesso inválida.',
    });
  }
  return value;
}

function cookieOptions(originValue: string): CookieOptions {
  return {
    httpOnly: true,
    secure: originValue.startsWith('https://'),
    sameSite: 'strict',
    path: '/api/attendances/employee-offline',
  };
}

@Controller('attendances/employee-offline')
export class EmployeeOfflineAttendanceController {
  constructor(private readonly offline: EmployeeOfflineAttendanceService) {}

  @Post('session')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthGuard)
  async prepare(
    @Req() req: Request & { user: TokenPayload & { exp?: number } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const source = validateOrigin(req);
    const session = await this.offline.prepare(
      req.user,
      source,
      extractCookie(req),
    );
    res.cookie(COOKIE, session.token, {
      ...cookieOptions(source),
      expires: new Date(session.expiresAt),
    });
    return { accountId: session.accountId, expiresAt: session.expiresAt };
  }

  @Post('submit')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Req() req: Request, @Body(validation) dto: OfflineSubmitDto) {
    return this.offline.submit(extractCookie(req), validateOrigin(req), dto);
  }

  @Post('status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  status(@Req() req: Request, @Body(validation) dto: OfflineStatusDto) {
    return this.offline.status(extractCookie(req), validateOrigin(req), dto);
  }

  @Post('revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const source = validateOrigin(req);
    const result = await this.offline.revoke(extractCookie(req), source);
    res.clearCookie(COOKIE, cookieOptions(source));
    return result;
  }
}
