import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';
import { ViewStudentDTO } from './dto/view-student.dto';

@Controller('estudantes')
export class StudentController {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly service: StudentService,
  ) {}

  @Get('listar-todos')
  getStudents(): ViewStudentDTO[] {
    return this.mapper.toListDTO(this.service.getStudents());
  }

  @Get('encontrar-por-ra/:ra')
  getStudentByRa(@Param('ra') ra: string): ViewStudentDTO {
    return this.mapper.toDTO(this.service.getStudentByRa(ra));
  }

  @Post('criar')
  async createStudent(@Body() student: CreateStudentDTO) {
    await this.service.createStudent(student);
  }
}
