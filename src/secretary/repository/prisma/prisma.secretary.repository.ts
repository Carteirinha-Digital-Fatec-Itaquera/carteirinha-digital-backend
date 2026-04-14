import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { SecretaryRepository } from "../secretary.repository";
import { SecretaryEntity } from "../../entities/secretary.entity";

@Injectable()
export class PrismaSecretaryRepository implements SecretaryRepository {
  constructor(private prisma: PrismaService) {}

  findAll(): Promise<SecretaryEntity[]> {
    return this.prisma.secretary.findMany();
  }

  findById(id: number): Promise<SecretaryEntity | null> {
    return this.prisma.secretary.findUnique({
      where: { id: id },
    });
  }

  findByEmail(email: string): Promise<SecretaryEntity | null> {
    return this.prisma.secretary.findUnique({
      where: { email },
    });
  }

  async create(secretary: SecretaryEntity): Promise<void> {
    // Calcula o dueDate para exatamente 1 ano a partir de hoje
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    // Validação para garantir que birthDate seja um objeto Date válido.
    // Como o seu schema exige DateTime (obrigatório), se o valor for inválido,
    // usamos a data atual como fallback para evitar erros de banco e tipagem.
    let validBirthDate = new Date(secretary.birthDate);
    if (isNaN(validBirthDate.getTime())) {
      validBirthDate = new Date(); 
    }

    await this.prisma.secretary.create({
      data: {
        name: secretary.name,
        email: secretary.email,
        password: secretary.password,
        dueDate: oneYearFromNow, // Valor calculado automaticamente
        birthDate: validBirthDate, // Garantido como objeto Date
        lastLogin: secretary.lastLogin,
      },
    });
  }

  async update(secretary: SecretaryEntity): Promise<void> {
    await this.prisma.secretary.update({
      where: { id: secretary.id },
      data: {
        name: secretary.name,
        email: secretary.email,
      },
    });
  }

  async delete(id: number): Promise<void> {
    await this.prisma.secretary.delete({
      where: { id },
    });
  }

  async updateLastLogin(id: number): Promise<void> {
    await this.prisma.secretary.update({
      where: { id },
      data: {
        lastLogin: new Date(),
      },
    });
  }

  async updatePassword(id: number, newPassword: string): Promise<void> {
    await this.prisma.secretary.update({
      where: { id },
      data: {
        password: newPassword,
      },
    });
  }
}