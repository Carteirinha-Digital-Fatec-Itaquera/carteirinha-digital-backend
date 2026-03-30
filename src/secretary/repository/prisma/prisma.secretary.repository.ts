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
    await this.prisma.secretary.create({
       data: {
         name: secretary.name,
         email: secretary.email,
         dueDate: secretary.dueDate,
         password: secretary.password,
       },
     });
    }
    async update(secretary: SecretaryEntity): Promise<void> {    
       await this.prisma.secretary.update({ 
            where: { id: secretary.id },
            data: {
                name: secretary.name,
                email: secretary.email,
            }
        });
    }
    async delete(id: number): Promise<void> {
        await this.prisma.secretary.delete({
            where: { id },
        });
    }
}
