import { Injectable } from '@nestjs/common';
import { SecretaryEntity } from '../entities/secretary.entity';
import { ViewSecretaryDTO } from '../dto/view-secretary.dto';
import { CreateSecretaryDTO } from '../dto/create-secretary.dto';

@Injectable()
export class SecretaryMapper {
  constructor() {}

  toEntity(secretary: CreateSecretaryDTO): SecretaryEntity {
    return new SecretaryEntity(
      secretary.id || 0,
      secretary.name,
      secretary.email,
      new Date(secretary.dueDate),
      secretary.password || "",
      secretary.birthDate
    );
  }

  toDTO(secretary: SecretaryEntity): ViewSecretaryDTO {
  return new ViewSecretaryDTO(
    secretary.id,
    secretary.name,
    secretary.email,
    secretary.birthDate,
    secretary.dueDate.toISOString(),
  );
}

  toListDTO(secretary: SecretaryEntity[]): ViewSecretaryDTO[] {
    return secretary.map((secretary) => this.toDTO(secretary));
  }
}