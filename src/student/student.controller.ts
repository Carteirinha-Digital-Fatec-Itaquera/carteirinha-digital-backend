import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentService } from './student.service';

@Controller('estudantes')
export class StudentController {
  constructor(private readonly service: StudentService) {}

  @Get('listartodos')
  getStudents() {
    return this.service.getStudents();
  }

  @Get('encontrar/:ra')
  getStudent(@Param('ra') ra: string) {
    return this.service.getStudent(ra);
  }

  @Post('criar')
  createStudent(@Body() student: CreateStudentDTO) {
    return this.service.createStudent(student);
  }
}
