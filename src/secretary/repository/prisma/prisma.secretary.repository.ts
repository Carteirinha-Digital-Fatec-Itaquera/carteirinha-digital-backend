
//Novo arquivo criado para aplicar o memso modelo da série estudantes
//Arquivo do tipo de configuração de implantação/definição das funções/operações/métodos 
//da classe de PrismaSecretaryrepository

import { PrismaService } from "src/database/prisma.service";
import { SecretaryEntity } from "src/secretary/model/secretary.entity";
import { secretaryRepository } from "../secretary.repository";
import { Injectable} from "@nestjs/common"

@Injectable()
export class PrismaSecretaryRepository implements secretaryRepository {
  constructor(private prisma: PrismaService) {}

  findAll(): Promise<SecretaryEntity[]> {
    return this.prisma.secretary.findMany();
  }
  findById(id_secretary: number): Promise<SecretaryEntity | null> {
    return this.prisma.secretary.findUnique({
      where: { id: id_secretary},
    });
  }

  findByEmail(email: string): Promise<SecretaryEntity | null> {
    return this.prisma.secretary.findUnique({
      where: { email: email },
    });
  }

  async create(secretary: SecretaryEntity): Promise<void> {
    await this.prisma.secretary.create({
      data: {
        id: secretary.id,
        name: secretary.name,
        email: secretary.email,
        password: secretary.password
      },
    });
  }
}
