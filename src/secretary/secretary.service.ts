import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service'; // ajusta se necessário
import { CreateSecretaryDTO } from './dto/create-secretary.dto';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { SecretaryRepository } from './repository/secretary.repository';
import { SecretaryEntity } from './entities/secretary.entity';
import { HashContentService } from 'src/utils/hashContentService';


@Injectable()
export class SecretaryService {
  constructor(
    private readonly mapper: SecretaryMapper,
    private readonly repository: SecretaryRepository,
    private readonly hashService: HashContentService
  ) {}

  async getSecretary(): Promise<SecretaryEntity[]> {
    return await this.repository.findAll();
  }

  async getSecretaryById(id: number): Promise<SecretaryEntity> {
    const result = await this.repository.findById(id);

    if (!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }

    return result;
  }

  async getSecretaryByEmail(email: string): Promise<SecretaryEntity> {
    const result = await this.repository.findByEmail(email);

    if (!result) {
      throw new NotFoundException(
        `Secretaria com email '${email}' não encontrada`,
      );
    }

    return result;
  }

  async createSecretary(secretary: CreateSecretaryDTO) {
    // const passwordHash = await this.hashService.hashContent(secretary)
    try{
      secretary.password = await this.hashService.hashContent(secretary.password)
      return await this.repository.create(this.mapper.toEntity(secretary));
    }catch (error){
      return {msg: `\nErro ao criar usuário do tipo Secretaria.\n${error}`}
    }
    
  }

  async updateSecretary(secretary: SecretaryEntity) {
    const result = await this.repository.findById(secretary.id)
    
    if(!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }
    return await this.repository.update(secretary);
}

  async deleteSecretary(id: number): Promise<void> {
    const result = await this.repository.findById(id);

    if (!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }
    return await this.repository.delete(id);
  }
}