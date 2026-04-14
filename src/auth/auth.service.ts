import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExceptionsHandler } from '@nestjs/core/exceptions/exceptions-handler';
import { JwtService } from '@nestjs/jwt';
import { isFirebasePushId } from 'class-validator';
import { STATUS_CODES } from 'http';
import { first } from 'rxjs';
import { SecretaryEntity } from '../../src/secretary/entities/secretary.entity';
import { SecretaryService } from '../../src/secretary/secretary.service';
import { StudentService } from '../../src/student/student.service';
import { HashContentService } from '../../src/utils/hashContentService';
import { TokenPayload } from './dto/payload.dto';
import { StudentEntity } from 'src/student/entities/student.entity';

import { MailService } from 'src/utils/mailService';

import { VerificationService } from '../verification/verification.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly studentService: StudentService,
    private readonly secretaryService: SecretaryService,
    private readonly jwtService: JwtService,
    private readonly hashService:HashContentService,
    private readonly mailService: MailService, 
    private readonly verificationService: VerificationService,
  ) {}

  async signInStudent(email: string, pass: string){
    const student = await this.studentService.getStudentByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';
    if (!student) {
      throw new UnauthorizedException(messageError);
    }
    // if (student.password == null) {
    //   throw new ConflictException('A senha desta conta ainda não foi definida');
    // }
    
    // if (student.password !== pass) {
    //   throw new UnauthorizedException(messageError);
    // }
    const isValidPassword:boolean = await this.hashService.compareHash(student.password, pass)
    if (!isValidPassword){
        throw new ConflictException('A senha desta conta ainda não foi definida');
    } 


    const isFirstLogin = student.lastLogin ===null
    if(!isFirstLogin){
      await this.setLoginTimestampStudent(student.ra)    
    }

    const payload:TokenPayload = {
      sub: student.ra,
      // email: student.email,
      role: 'student',
      firstLogin:isFirstLogin
    };
    const token =await this.jwtService.signAsync(payload);
    return {accessToken: token, firstLogin:isFirstLogin}
  }

  // async signInSecretary(email: string, pass: string): Promise<string> {
  async signInSecretary(email: string, pass: string){
    const secretary = await this.secretaryService.getSecretaryByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';

    if (!secretary) {
      throw new UnauthorizedException(messageError);
    }

    // if (secretary.password !== pass) {
    //   throw new UnauthorizedException(messageError);
    // }
    const isValidPassword:boolean = await this.hashService.compareHash(secretary.password, pass)
    if (!isValidPassword){
        throw new ConflictException('A senha desta conta ainda não foi definida');
    } 
    const isFirstLogin = secretary.lastLogin===null

    // console.log(`\nn\n\n${isFirstLogin}`)
    if (!isFirstLogin) {
      await this.setLoginTimestamp(secretary.id);
    }

    const payload:TokenPayload = {
      sub: secretary.id,
      // email: secretary.email,
      role: 'secretary',
      firstLogin: isFirstLogin
    };

    const token = await this.jwtService.signAsync(payload);

    return {accessToken: token, firstLogin: isFirstLogin}



  }

  async changePassword(newPassword: string, valuesSearch:number|string, userType: 'student'|'secretary'):Promise<void>{ 
    
    try{
      const hashedPassword = await this.hashService.hashContent(newPassword)
      if(userType === 'student'){
        const [resPasswordUpdate, resLastLoginUpdate] = await Promise.all(
          [
          this.studentService.updateStudentPassword(String(valuesSearch), hashedPassword),
          this.studentService.updateLastLoginStudent(String(valuesSearch))]
        )
        // console.log(`\n\n\n${resPasswordUpdate}\n\n ${resLastLoginUpdate}`)
      }
      else {

        const idNumeric = Number(valuesSearch);
        if (isNaN(idNumeric)) {
            throw new Error("ID de secretária inválido para conversão numérica");
        }
          
        await Promise.all([
            this.secretaryService.updateSecretaryPassword(idNumeric, hashedPassword),
            this.secretaryService.updateLastLogin(idNumeric)
        ]);

      }
    }catch(error){
      console.error('Erro ao troca senha', error)
      throw new InternalServerErrorException('Não é possível atualizar a senha')
    }
    
  }


  
  async sendForgotPasswordEmail(email: string, userType: 'student' | 'secretary') {
    let user;
    if (userType === 'student') {
      user = await this.studentService.getStudentByEmail(email);
    } else if(userType === 'secretary') {
      user = await this.secretaryService.getSecretaryByEmail(email);
    }
    if (!user) {
      return { message: 'Se o e-mail estiver cadastrado, você receberá um link em breve.' };
    }

    const secret = process.env.JWT_SECRET + user.password;
    const token = await this.jwtService.signAsync(
      { sub: user.ra || user.id, role: userType },
      { secret, expiresIn: '15h' }
    );
    console.log(`${token}, \n\n\n\n${user.ra || user.id}\n\n\n ${userType}`)
    const resetUrl = `http://localhost:3000/reset-password?token=${token}&id=${user.ra || user.id}&type=${userType}`;
    await this.mailService.sendResetPasswordEmail(user.email, user.name, resetUrl);
    return { message: 'E-mail enviado com sucesso.' };
  }

  async resetPasswordWithToken(token: string, id: string|number, userType: 'student' | 'secretary', newPass: string) {
    console.log(`\n\n${token}, \n${id}, \n\n${userType}, \n\n${userType}, ${newPass}`)
    let user;
    if (userType === 'student') {
      user = await this.studentService.getStudentByRa(String(id)); // ou getByRA
    } else if(userType === 'secretary') {
      user = await this.secretaryService.getSecretaryById(Number(id));
    }

    if (!user) throw new UnauthorizedException('Usuário inválido');

    try {
      const secret = process.env.JWT_SECRET + user.password;
      await this.jwtService.verifyAsync(token, { secret });

      await this.changePassword(newPass, id, userType);
      
      return { message: 'Senha redefinida com sucesso!' };
    } catch (e) {
      throw new UnauthorizedException('Link expirado ou já utilizado.');
    }
  }

  private async setLoginTimestamp(id: number) {
    try {
      const valueLastLogin =await this.secretaryService.updateLastLogin(id);
      // console.log(`\n\n\n\n${valueLastLogin}`)
    } catch (error) {
      console.error('Erro ao atualizar último login:', error);
    }
  }
  
  
  private async setLoginTimestampStudent(ra: string) {
    try {
      await this.studentService.updateLastLoginStudent(ra);
    } catch (error) {
      console.error('Erro ao atualizar último login:', error);
    }
  }



}
  async signInSecretary(email: string, pass: string): Promise<string> {
    const secretary = await this.secretaryService.getSecretaryByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';

    if (!secretary) {
      throw new UnauthorizedException(messageError);
    }
    if (secretary.password !== pass) {
      throw new UnauthorizedException(messageError);
    }
    const payload = {
      id: secretary.id,
      email: secretary.email,
    };
    return this.jwtService.signAsync(payload);
  }

  async sendVerificationCode(email: string) {
    const student = await this.studentService.getStudentByEmail(email);
    if (!student) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return this.verificationService.sendCode(email);
  }

  async verifyCodeAndLogin(email: string, code: string) {
    const isValid = await this.verificationService.verifyCode(email, code);

    if (!isValid) {
      throw new UnauthorizedException('Código inválido ou expirado');
    }

    const student = await this.studentService.getStudentByEmail(email);

    const payload = {
      ra: student.ra,
      email: student.email,
    };
    const token = await this.jwtService.signAsync(payload);

    return {
      access_token: token,
      verified: true,
      user: {
        ra: student.ra,
        name: student.name,
        email: student.email,
      },
    };
  }
}
