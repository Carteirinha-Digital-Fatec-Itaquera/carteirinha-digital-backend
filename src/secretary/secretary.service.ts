import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
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
    try{
      const rawPassoword = this.generateInitialPassword(secretary.birthDate)

      const hashPassowrd = await this.hashService.hashContent(rawPassoword)
      const entity = this.mapper.toEntity({
        ...secretary,
        password:hashPassowrd,
        lastLogin:null
      })
      
      // return await this.repository.create(this.mapper.toEntity(secretary));
      return await this.repository.create(entity)
    }catch (error){
      // return {msg: `\nErro ao criar usuário do tipo Secretaria.\n${error}`}
      throw new InternalServerErrorException(`Erro ao criar secretaria: ${error.message}`)
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


  async updateLastLogin(id: number) {
    return await this.repository.updateLastLogin(id);
  }

  private generateInitialPassword(birthDate: Date): string {
    const date = new Date(birthDate);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = String(date.getUTCFullYear());
    
    return `${day}${month}${year}`;
  }
}