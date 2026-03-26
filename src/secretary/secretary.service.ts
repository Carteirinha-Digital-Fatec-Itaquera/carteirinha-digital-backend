import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service'; // ajusta se necessário
import { CreateSecretaryDTO } from './dto/create-secretary.dto';

@Injectable()
export class SecretaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSecretary() {
    return await this.prisma.secretary.findMany();
  }

  async getSecretaryById(id: string) {
    const result = await this.prisma.secretary.findUnique({
      where: { id: Number(id) },
    });

    if (!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }

    return result;
  }

  async getSecretaryByEmail(email: string) {
    const result = await this.prisma.secretary.findUnique({
      where: { email },
    });

    if (!result) {
      throw new NotFoundException(
        `Secretaria com email '${email}' não encontrada`,
      );
    }

    return result;
  }

  async createSecretary(secretary: CreateSecretaryDTO) {
    return await this.prisma.secretary.create({
      data: {
        name: secretary.name,
        email: secretary.email,
        dueDate: new Date(secretary.dueDate),
        password: secretary.password,
      },
    });
  }
}