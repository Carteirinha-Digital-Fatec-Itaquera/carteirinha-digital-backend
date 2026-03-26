// import { StudentEntity } from '../entities/student.entity';
import { SecretaryEntity } from "../model/secretary.entity";

export abstract class secretaryRepository {
  abstract findAll(): Promise<SecretaryEntity[]>;

  abstract findById(id:Number): Promise<SecretaryEntity | null>

  abstract findByEmail(email: string): Promise<SecretaryEntity | null>;

  abstract create(secretary: SecretaryEntity): Promise<void>;
}
