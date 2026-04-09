import { Body, Controller, HttpCode, HttpStatus, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDTO } from './dto/auth.dto';
import { TokenDTO } from './dto/token.dto';
import { Request, Response } from '@nestjs/common';

import { StudentService } from 'src/student/student.service';
import { SecretaryService } from 'src/secretary/secretary.service';
import { PasswordDTO } from './dto/resetPassword.dto';
import { BadRequestException } from '@nestjs/common';

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
        token: results.accessToken
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
    
    if (results.firstLogin) {
      return {
        message: 'Troca de senha obrigatória',
        mustChangePassword: true,
        token: results.accessToken 
      };
    }
    console.log(`${results.firstLogin}`)
    return new TokenDTO(results.accessToken);
  

  }

  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(
    @Request()req:any,
    @Body() passwordDTO: PasswordDTO
  ): Promise <void>{

    // let userId:string|number
    // let userType: 'student'|'secretary'
    
    // if(req.user){
    //   userId = req.user.sub
    //   userType = req.user.role
    //   console.log(`\n\n\n${userId}\n\n\n ${userType}`)
    // }else if(passwordDTO.token){
    //   try{
    //     const decoded = await this.jwtService.verifyAsync<TokenPayload>(passwordDTO.token)
    //     userId = decoded.sub
    //     userType = decoded.role as 'student'|'secretary'
    //   }catch(error){
    //     console.log(error)
    //     throw new UnauthorizedException('Token de recuperação invalido ou expirado')
    //   }
    // }
    // else {
    //   throw new BadRequestException('Identificação do usuário não encontrada');
    // }
    const userId = req.user.sub
    const userType = req.user.role as 'student' |'secretary'
    // console.log(`\n\n\nesse é seu id: ${userId} \n\n\n${userType}`)
    await this.authService.changePassword(
      passwordDTO.newPassword,
      userId,
      userType
    )
  } 

  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async esqueciMinhaSenha(
    @Request()req:any,
    @Body() passwordDTO: PasswordDTO
  ):Promise<any>{
    const userId = req.user.sub
    const userType = req.user.role as 'student' |'secretary'
    await this.authService.changePassword(
      passwordDTO.newPassword,
      userId,
      userType
    )
  }
}
