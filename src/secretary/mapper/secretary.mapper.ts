import { Injectable } from '@nestjs/common';
import { SecretaryEntity } from '../model/secretary.entity';
import { ViewSecretaryDTO } from '../dto/view-secretary.dto';
import { CreateSecretaryDTO } from '../dto/create-secretary.dto';

@Injectable()
export class SecretaryMapper {
  constructor() {}

  toEntity(secretary: CreateSecretaryDTO): SecretaryEntity {
    return new SecretaryEntity(
      secretary.id,
      secretary.name,
      secretary.email,
      '',
    );
  }

  toDTO(secretary: SecretaryEntity): ViewSecretaryDTO {
    return new ViewSecretaryDTO(secretary.name, secretary.email);
  }

  toListDTO(secretary: SecretaryEntity[]): ViewSecretaryDTO[] {
    return secretary.map((secretary) => this.toDTO(secretary));
  }
}
