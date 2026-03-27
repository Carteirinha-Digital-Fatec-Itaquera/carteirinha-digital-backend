import { Injectable } from '@nestjs/common';
import { SecretaryEntity } from '../model/secretary.entity';
import { ViewSecretaryDTO } from '../dto/view-secretary.dto';

@Injectable()
export class SecretaryMapper {
  constructor() {}

  toDTO(secretary: SecretaryEntity): ViewSecretaryDTO {
    return new ViewSecretaryDTO(secretary.name, secretary.email);
  }

  toListDTO(secretary: SecretaryEntity[]): ViewSecretaryDTO[] {
    return secretary.map((secretary) => this.toDTO(secretary));
  }
}