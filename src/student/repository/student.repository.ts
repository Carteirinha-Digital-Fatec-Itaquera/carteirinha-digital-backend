import { StudentEntity } from '../entities/student.entity';

export abstract class StudentRepository {
  abstract findAll(): Promise<StudentEntity[]>;

  abstract findById(id: string): Promise<StudentEntity | null> //

  abstract findByRa(ra: string): Promise<StudentEntity | null>;

  abstract findByEmail(email: string): Promise<StudentEntity | null>;

  abstract create(student: StudentEntity): Promise<void>;//

  abstract update(student: StudentEntity): Promise<void>;

  abstract delete(id: string): Promise<void>;
}
