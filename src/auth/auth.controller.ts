import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDTO } from './dto/auth.dto';
import { TokenDTO } from './dto/token.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signIn(@Body() authDTO: AuthDTO): Promise<TokenDTO> {
    const token = await this.authService.signIn(
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
      authDTO.password
    );
    return new TokenDTO(token);
  }
}
