import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';
import { ViewStudentDTO } from './dto/view-student.dto';

import { HashContentService } from 'src/utils/hashContent';

@Controller('estudantes')
export class StudentController {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly service: StudentService,
    // private readonly hashService: HashContentService // poderia ser depois para centralizar em um só paramentro e não ter que 
    //ficar instanciando toda hora em cada método
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
    console.log(student);  
    if (!student) {
      return { msg: "body is missing" };
    }
    if (!student.password) {
      return { msg: "password is required" };
    }
    const hashService = new HashContentService()
    const passwordHash = await hashService.hashContent(student.password)
    try{
      student.password = passwordHash
      return await this.service.createStudent(student);
    }catch(error){
      console.log(error)
      return { msg: "error creating user" };

    }
  }

  @Put('atualizar/:ra')
  async updateStudent(
    @Param('ra') ra: string,
    @Body() student: CreateStudentDTO
  ) {
    
    return await this.service.updateStudents(this.mapper.toEntity({ ...student, ra }));
  }

  @Delete('deletar/:ra')
  async deleteStudent(@Param('ra') ra: string) {
    return await this.service.deleteStudent(ra);
  }
}
