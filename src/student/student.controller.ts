import { Body, Controller, Get, Param, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';
import { ViewStudentDTO } from './dto/view-student.dto';
import { UploadService } from '../upload/upload.service';

@Controller('estudantes')
export class StudentController {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly service: StudentService,
    private readonly uploadService: UploadService,
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

  // ========== NOVOS ENDPOINTS DE FOTO ==========

  @Post('upload-foto')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(@UploadedFile() file: Express.Multer.File, @Body() body: { ra: string }) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    if (!body.ra) {
      throw new BadRequestException('RA é obrigatório');
    }

    const photoUrl = await this.uploadService.uploadPhoto(file, body.ra);
    return this.service.requestPhotoApproval(body.ra, photoUrl);
  }

  @Get('foto-status/:ra')
  async getPhotoStatus(@Param('ra') ra: string) {
    return this.service.getPhotoStatus(ra);
  }
}