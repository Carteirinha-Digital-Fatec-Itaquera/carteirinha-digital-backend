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
  async getStudents(): Promise<ViewStudentDTO[]> {
    return this.mapper.toListDTO(await this.service.getStudents());
  }

  @Get('encontrar-por-ra/:ra')
  async getStudentByRa(@Param('ra') ra: string): Promise<ViewStudentDTO> {
    return this.mapper.toDTO(await this.service.getStudentByRa(ra));
  }

  @Get('encontrar-por-email/:email')
  async getStudentByEmail(
    @Param('email') email: string,
  ): Promise<ViewStudentDTO> {
    return this.mapper.toDTO(await this.service.getStudentByEmail(email));
  }

  @Post('criar')
  async createStudent(@Body() student: CreateStudentDTO) {
    await this.service.createStudent(student);
  }
}
