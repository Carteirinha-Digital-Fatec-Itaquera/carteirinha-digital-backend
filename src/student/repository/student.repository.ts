import { StudentEntity } from '../entities/student.entity';

export abstract class StudentRepository {
  abstract findAll(): Promise<StudentEntity[]>;

  abstract findByRa(ra: string): Promise<StudentEntity | null>;

  abstract findByEmail(email: string): Promise<StudentEntity | null>;

  abstract create(student: StudentEntity): Promise<void>;
}
