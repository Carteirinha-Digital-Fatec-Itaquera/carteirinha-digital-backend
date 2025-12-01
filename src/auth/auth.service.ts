import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SecretaryService } from 'src/secretary/secretary.service';
import { StudentService } from 'src/student/student.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly studentService: StudentService,
    private readonly secretaryService: SecretaryService,
    private readonly jwtService: JwtService,
  ) {}

  async signInStudent(email: string, pass: string): Promise<string> {
    const student = await this.studentService.getStudentByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';
    if (student == null) {
      throw new UnauthorizedException(messageError);
    }
    if (student.password == null) {
      throw new ConflictException('A senha desta conta ainda não foi definida');
    }
    if (student.password !== pass) {
      throw new UnauthorizedException(messageError);
    }
    const payload = {
      ra: student.ra,
      email: student.email,
    };
    return this.jwtService.signAsync(payload);
  }

  signInSecretary(email: string, pass: string): Promise<string> {
    const secretary = this.secretaryService.getSecretaryByEmail(email);
    if (secretary.password !== pass) {
      throw new UnauthorizedException();
    }
    const payload = {
      id: secretary.id,
      email: secretary.email,
    };
    return this.jwtService.signAsync(payload);
  }
}
