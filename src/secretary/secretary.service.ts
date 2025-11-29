import { Injectable, NotFoundException } from '@nestjs/common';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { SecretaryEntity } from './model/secretary.entity';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';

@Injectable()
export class SecretaryService {
  constructor(private readonly mapper: SecretaryMapper) {}

  private list: SecretaryEntity[] = [];

  getSecretary(): SecretaryEntity[] {
    return this.list.map((secretary) => secretary);
  }

  getSecretaryById(id: string): SecretaryEntity {
    const result = this.list.find((secretary) => secretary.id == id);
    if (result == undefined) {
      throw new NotFoundException('Secretaria não encontrada');
    }
    return result;
  }

  getSecretaryByEmail(email: string): SecretaryEntity {
    const result = this.list.find((secretary) => secretary.email === email);

    if (!result) {
      throw new NotFoundException(
        `Secretaria com email '${email}' não encontrada`,
      );
    }
    return result;
  }

  createSecretary(secretary: CreateSecretaryDTO) {
    this.list.push(this.mapper.toEntity(secretary));
  }
}
