import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

  async signInStudent(email: string, pass: string): Promise<string> {
    const student = await this.studentService.getStudentByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';
    if (student == null) {
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
    const payload = {
      ra: student.ra,
      email: student.email,
    };
    return this.jwtService.signAsync(payload);
  }

  async signInSecretary(email: string, pass: string): Promise<string> {
    const secretary = await this.secretaryService.getSecretaryByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';

    if (!secretary) {
      throw new UnauthorizedException(messageError);
    }
    if (!secretary.lastLogin){
      
    }
    // if (secretary.password !== pass) {
    //   throw new UnauthorizedException(messageError);
    // }
    const isValidPassword:boolean = await this.hashService.compareHash(secretary.password, pass)
    if (!isValidPassword){
        throw new ConflictException('A senha desta conta ainda não foi definida');
    } 
    const payload = {
      id: secretary.id,
      email: secretary.email,
    };

    return this.jwtService.signAsync(payload);
}
  
}
