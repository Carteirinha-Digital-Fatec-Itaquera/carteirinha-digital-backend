import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StudentService } from 'src/student/student.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly studentService: StudentService,
    private readonly jwtService: JwtService,
  ) {}

  signIn(email: string, pass: string): Promise<string> {
    const student = this.studentService.getStudentByEmail(email);
    if (student.password !== pass) {
      throw new UnauthorizedException();
    }
    const payload = {
      ra: student.ra,
      email: student.email,
    };
    return this.jwtService.signAsync(payload);
  }
}
