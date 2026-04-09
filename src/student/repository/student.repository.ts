import { StudentEntity } from '../entities/student.entity';

export abstract class StudentRepository {
  abstract findAll(): Promise<StudentEntity[]>;

  abstract findByRa(ra: string): Promise<StudentEntity | null>;

  abstract findByEmail(email: string): Promise<StudentEntity | null>;

  abstract findByTokenQrcode(qrcode: string): Promise<StudentEntity | null>;

  abstract create(student: StudentEntity): Promise<void>;
  
  abstract update(student: StudentEntity): Promise<void>;

  abstract delete(ra: string): Promise<void>;

  abstract updateLastLogin(ra: string): Promise<void>
  abstract updatePassword(ra: string, newPassword:string): Promise<void>

  // abstract resetPassword(email:string): Promise<void>
}
