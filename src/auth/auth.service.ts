import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ExceptionsHandler } from '@nestjs/core/exceptions/exceptions-handler';
import { JwtService } from '@nestjs/jwt';
import { isFirebasePushId } from 'class-validator';
import { STATUS_CODES } from 'http';
import { first } from 'rxjs';
import { SecretaryEntity } from 'src/secretary/entities/secretary.entity';
import { SecretaryService } from 'src/secretary/secretary.service';
import { StudentService } from 'src/student/student.service';
import { HashContentService } from 'src/utils/hashContentService';





@Injectable()
export class AuthService {
  constructor(
    private readonly studentService: StudentService,
    private readonly secretaryService: SecretaryService,
    private readonly jwtService: JwtService,
    private readonly hashService:HashContentService
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

    const payload = {
      ra: student.ra,
      email: student.email,
      firstLogin:isFirstLogin
    };
    const token =await this.jwtService.signAsync(payload);
    return {accesstoken: token, firstLogin:isFirstLogin}
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
    if (!isFirstLogin) {
      await this.setLoginTimestamp(secretary.id);
    }

    const payload = {
      id: secretary.id,
      email: secretary.email,
      firstLogin: isFirstLogin
    };
    const token = await this.jwtService.signAsync(payload);

    return {accessToken: token, firstLogin: isFirstLogin}



  }
  private async setLoginTimestamp(id: number) {
    try {
      await this.secretaryService.updateLastLogin(id);
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
