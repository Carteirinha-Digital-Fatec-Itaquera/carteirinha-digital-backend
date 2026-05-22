import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/database/prisma.service';


@Injectable()
export class StudentCleanupService {
  private readonly logger = new Logger(StudentCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Roda todo dia 1 de Janeiro e 1 de Julho às 00:00
  @Cron('0 0 1 1,7 *')
  async cleanupConcludedStudents() {
    this.logger.log('Iniciando limpeza de alunos concluídos...');

    const now = new Date();

    const studentsToDelete = await this.prisma.student.findMany({
      where: {
        status: 'Concluído',
        dueDate: { lte: now },
      },
    });

    if (studentsToDelete.length === 0) {
      this.logger.log('Nenhum aluno para remover.');
      return;
    }

    // Salva log antes de deletar
    await this.prisma.studentLog.createMany({
      data: studentsToDelete.map((s) => ({
        ra: s.ra,
        course: s.course,
        status: s.status,
        name: s.name,
        admission: s.admission,
        email: s.email,
        cpf: s.cpf||'',
        birthDate: s.birthDate || '',
        dueDate: s.dueDate,
      })),
    });

    // Deleta os alunos
    await this.prisma.student.deleteMany({
      where: {
        ra: { in: studentsToDelete.map((s) => s.ra) },
      },
    });

    this.logger.log(`${studentsToDelete.length} aluno(s) removido(s) e logado(s).`);
  }
}