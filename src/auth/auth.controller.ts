import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDTO } from './dto/auth.dto';
import { TokenDTO } from './dto/token.dto';
import { FirstLoginService } from 'src/utils/firstLoginService';


@Controller('autenticacao')
export class AuthController {
  constructor(private authService: AuthService, private readonly firstLogin: FirstLoginService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signInStudent(@Body() authDTO: AuthDTO): Promise<TokenDTO> {
    const isFirstLogin = await this.firstLogin.verificarPrimeiroLogin(authDTO);

    // if (isFirstLogin) {
      
    //   return {
    //   firstLogin: true,
    //   message: 'Primeiro login, redefina sua senha',
    //   };
    // }
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
}
