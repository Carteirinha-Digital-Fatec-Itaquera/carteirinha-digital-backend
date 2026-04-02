import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDTO } from './dto/auth.dto';
import { TokenDTO } from './dto/token.dto';

@Controller('autenticacao')
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signInStudent(@Body() authDTO: AuthDTO): Promise<TokenDTO> {
    const token = await this.authService.signInStudent(
      authDTO.email,
      authDTO.password,
    );
    return new TokenDTO(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login-secretaria')
  async signInSecretary(@Body() authDTO: AuthDTO): Promise<TokenDTO> {
    const token = await this.authService.signInSecretary(
      authDTO.email,
      authDTO.password,
    );
    return new TokenDTO(token);
  }

  // NOVOS ENDPOINTS PARA 2FA
  @HttpCode(HttpStatus.OK)
  @Post('enviar-codigo')
  async sendVerificationCode(@Body() body: { email: string }) {
    return this.authService.sendVerificationCode(body.email);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verificar-codigo')
  async verifyCodeAndLogin(@Body() body: { email: string; code: string }) {
    return this.authService.verifyCodeAndLogin(body.email, body.code);
  }
}