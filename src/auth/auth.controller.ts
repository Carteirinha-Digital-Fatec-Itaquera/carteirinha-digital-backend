import { Body, Controller, HttpCode, HttpStatus, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDTO } from './dto/auth.dto';
import { TokenDTO } from './dto/token.dto';
import { Request, Response } from '@nestjs/common';

import { StudentService } from 'src/student/student.service';
import { SecretaryService } from 'src/secretary/secretary.service';
import { PasswordDTO } from './dto/resetPassword.dto';
import { BadRequestException } from '@nestjs/common';
import { FirstAccessSetupDTO } from './dto/firstAccessSetup.dto';
import { JwtService } from '@nestjs/jwt';
import { TokenPayload } from './dto/payload.dto';

import { AuthGuard } from './auth.guard';


@Controller('autenticacao')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService:JwtService
    // private secretaryService: SecretaryService,
    // private studentService: StudentService

  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async signInStudent(@Body() authDTO: AuthDTO): Promise<TokenDTO> {

    const results = await this.authService.signInStudent(
      authDTO.email,
      authDTO.password,
    );
    if (results.firstLogin){
      return{
        message: "troca de senha Obrigatória",
        mustChangePassword: true,
        token: results.accessToken,
      }
    }
    return new TokenDTO(results.accessToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login-secretaria')
  async signInSecretary(
    @Body() authDTO: AuthDTO,
  ): Promise<TokenDTO> {
    const results = await this.authService.signInSecretary(
      authDTO.email,
      authDTO.password,
    );
    
    // if (results.firstLogin) {
    //   return {
    //     message: 'Troca de senha obrigatória',
    //     mustChangePassword: true,
    //     token: results.accessToken 
    //   };
    // }
    // console.log(`${results.firstLogin}`)
    // return new TokenDTO(results.accessToken);
  
    return {
      message: results.firstLogin ? "Troca de senha obrigatória" : "Login realizado",
      mustChangePassword: results.mustChangePassword,
      token: results.accessToken,
    };
  }

  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(
    @Request()req:any,
    @Body() passwordDTO: PasswordDTO
  ): Promise <void>{
    const userId = req.user.sub
    const userType = req.user.role as 'student' |'secretary'
    // console.log(`\n\n\nesse é seu id: ${userId} \n\n\n${userType}`)
    await this.authService.changePassword(
      passwordDTO.newPassword,
      userId,
      userType
    )

  } 


  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('first-access-setup')
  async firstAccessSetup(
    @Request() req: any,
    @Body() setupDTO: FirstAccessSetupDTO
  ): Promise<void> {
    const userId = req.user.sub; 
    const userType = req.user.role as 'student' | 'secretary';

    if (userType !== 'student') {
      throw new BadRequestException('Apenas estudantes podem realizar essa configuração inicial');
    }

    await this.authService.setupFirstAccess(
      userId,
      setupDTO.cpf,
      setupDTO.birthDate,
      setupDTO.newPassword
    );
  }




  @Post('forgot-password')
  async forgot(@Body() body: { email: string, type: 'student' | 'secretary' }) {
    return this.authService.sendForgotPasswordEmail(body.email, body.type);
  }

  @Post('reset') 
  async reset(
    @Body() body: { token: string; id: string; type: 'student' | 'secretary'; newPass: string }
  ) {
    return this.authService.resetPasswordWithToken(
      body.token,
      body.id,
      body.type,
      body.newPass
    );
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

