import { StudentEntity } from '../entities/student.entity';

export abstract class StudentRepository {
  abstract create(student: StudentEntity): Promise<void>;
}
