import { SecretaryEntity } from "../entities/secretary.entity";

export abstract class SecretaryRepository {
    abstract findAll(): Promise<SecretaryEntity[]>;

    abstract findById(id: number): Promise<SecretaryEntity | null>;

    abstract findByEmail(email: string): Promise<SecretaryEntity | null>;
    
    abstract create(secretary: SecretaryEntity): Promise<void>;
      
    abstract update(secretary: SecretaryEntity): Promise<void>;
    
    abstract delete(id: number): Promise<void>;
}