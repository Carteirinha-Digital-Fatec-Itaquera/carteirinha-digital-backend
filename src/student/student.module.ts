import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';

@Module({
  imports: [],
  controllers: [StudentController],
  providers: [StudentService, StudentMapper],
})
export class StudentModule {}
