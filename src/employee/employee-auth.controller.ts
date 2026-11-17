import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import {
  EmployeeChangePasswordDto,
  EmployeeEmailRequestDto,
  EmployeeLoginDto,
  EmployeeTokenPasswordDto,
} from './dto/employee-access.dto';
import { EmployeeAuthService } from './employee-auth.service';
import type { EmployeeEntity } from './entities/employee.entity';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

const STRICT_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

interface RequestWithIp {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function resolveClientIp(req: RequestWithIp): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || '127.0.0.1';
}

@Controller('autenticacao/funcionarios')
@UsePipes(STRICT_PIPE)
export class EmployeeAuthController {
  constructor(private readonly authService: EmployeeAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  login(@Body() dto: EmployeeLoginDto, @Req() req: RequestWithIp) {
    return this.authService.login(dto, resolveClientIp(req));
  }

  @Post('solicitar-acesso')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  requestAccess(
    @Body() dto: EmployeeEmailRequestDto,
    @Req() req: RequestWithIp,
  ) {
    return this.authService.requestAccess(dto, resolveClientIp(req));
  }

  @Post('ativar')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  activate(@Body() dto: EmployeeTokenPasswordDto) {
    return this.authService.activate(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  forgotPassword(
    @Body() dto: EmployeeEmailRequestDto,
    @Req() req: RequestWithIp,
  ) {
    return this.authService.forgotPassword(dto, resolveClientIp(req));
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  resetPassword(@Body() dto: EmployeeTokenPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('alterar-senha')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, EmployeeAccountGuard)
  @Header('Cache-Control', 'no-store')
  changePassword(
    @Req() req: { employee: EmployeeEntity },
    @Body() dto: EmployeeChangePasswordDto,
  ) {
    return this.authService.changePassword(req.employee, dto);
  }
}
