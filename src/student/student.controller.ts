import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';
import { ViewStudentDTO } from './dto/view-student.dto';
import { UploadService } from '../upload/upload.service';
import { UpdateStudentDto } from './dto/update-student.dto';

@Controller('estudantes')
export class StudentController {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly service: StudentService,
    private readonly uploadService: UploadService,
  ) {}

  @Get('listar-todos')
    async getStudents(@Query('query') query?: string): Promise<ViewStudentDTO[]> {
    return this.mapper.toListDTO(await this.service.getStudents(query));
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

  @Get('verificar/:qrcode')
  async verificarTokenQrcode(@Param('qrcode') qrcode: string): Promise<ViewStudentDTO>{
    return this.mapper.toDTO(await this.service.validarTokenQrcode(qrcode))
  }


  @Post('criar')
  async createStudent(@Body() student: CreateStudentDTO) {
    return await this.service.createStudent(student);
  }

  @Delete('deletar/:ra')
  async deleteStudent(@Param('ra') ra: string) {
    return await this.service.deleteStudent(ra);
  }

  @Put('atualizar/:ra')
async updateStudent(
  @Param('ra') ra: string,
  @Body() student: UpdateStudentDto
) {
  const existing = await this.service.getStudentByRa(ra);
  const merged = this.mapper.toEntity({
    ...existing,
    ...student,
    ra,
    birthDate: student.birthDate ?? existing.birthDate,
    dueDate: student.dueDate ?? existing.dueDate,
  } as any);
  return await this.service.updateStudents(merged);
}
  // ========== NOVOS ENDPOINTS DE FOTO ==========

  @Post('upload-foto')
  @UseInterceptors(FileInterceptor('file'))
  // async uploadPhoto(@UploadedFile() file: Express.Multer.File, @Body() body: { ra: string }) {
  async uploadPhoto(@UploadedFile() file: any, @Body() body: { ra: string }) {
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