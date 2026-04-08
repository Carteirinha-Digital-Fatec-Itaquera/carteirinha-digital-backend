  import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
  import { AuthService } from './auth.service';
  import { AuthDTO } from './dto/auth.dto';
  import { TokenDTO } from './dto/token.dto';
  import { Request, Response } from '@nestjs/common';

  import { StudentService } from 'src/student/student.service';
  import { SecretaryService } from 'src/secretary/secretary.service';
  import { PasswordDTO } from './dto/resetPassword.dto';

  @Controller('autenticacao')
  export class AuthController {
    constructor(
      private authService: AuthService,
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
          token: results.accesstoken
        }
      }
      
      
      
      return new TokenDTO(results.accesstoken);
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

    // @UseGuards(AuthGuard('jwt'))
    @HttpCode(HttpStatus.OK)
    @Post('reset-password')
    async resetPassword(
      @Request()req:any,
      @Body() passwordDTO: PasswordDTO
    ): Promise <void>{

      const user = req.user.id 
      const results = await this.authService.changePassword(
        passwordDTO.newPassword
      )



    } 

  }
