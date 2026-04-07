import { Injectable, NotFoundException } from '@nestjs/common';
import { StudentRepository } from 'src/student/repository/student.repository';
import { SecretaryRepository } from 'src/secretary/repository/secretary.repository';

@Injectable()
export class FirstLoginService {
  constructor(
    private readonly studentRepo: StudentRepository,
    private readonly secretaryRepo: SecretaryRepository,
  ) {}

  async verificarPrimeiroLogin(email: string): Promise<boolean> {
    const [student, secretary] = await Promise.all([
      this.studentRepo.findByEmail(email),
      this.secretaryRepo.findByEmail(email),
    ]);

    const user = student ?? secretary;

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return !user.lastLogin;
  }
}