import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SecretaryService } from 'src/secretary/secretary.service';
import { StudentService } from 'src/student/student.service';
import { VerificationService } from '../verification/verification.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly studentService: StudentService,
    private readonly secretaryService: SecretaryService,
    private readonly jwtService: JwtService,
    private readonly verificationService: VerificationService,
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