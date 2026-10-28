import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';
import { ViewStudentDTO } from './dto/view-student.dto';
import { UploadService } from '../upload/upload.service';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Res, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ActiveEventAccountGuard } from '../auth/active-event-account.guard';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import type { TokenPayload } from '../auth/dto/payload.dto';
import type{ Response } from 'express';


@Controller('estudantes')
export class StudentController {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly service: StudentService,
    private readonly uploadService: UploadService,
  ) {}

  @Get('historico-excluidos')
  @UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
  @Roles('secretary')
async downloadHistorico(@Res() res: Response) {
  const logs = await this.service.getStudentLogs();

  const header = 'RA,Nome,Email,CPF,Curso,Admissão,Status,Data Exclusão\n';
  const rows = logs.map((l) =>
    `${l.ra},${l.name},${l.email},${l.cpf},${l.course},${l.admission},${l.status},${l.deletedAt.toISOString()}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=historico-alunos.csv');
  res.send(header + rows);
}

  @Get('listar-todos')
  @UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
  @Roles('secretary')
    async getStudents(@Query('query') query?: string): Promise<ViewStudentDTO[]> {
    return this.mapper.toListDTO(await this.service.getStudents(query));
  }
  
  @Get('encontrar-por-ra/:ra')
  @UseGuards(AuthGuard, RolesGuard, ActiveEventAccountGuard)
  @Roles('student', 'secretary')
  async getStudentByRa(@Param('ra') ra: string, @Req() req: { user: TokenPayload }): Promise<ViewStudentDTO> {
    if (req.user.role === 'student' && req.user.sub !== ra) throw new ForbiddenException('Acesso restrito ao próprio cadastro.');
    const student = await this.service.getStudentByRa(ra);
    if (req.user.role === 'student' && (req.user.sub !== ra || req.user.accountId !== student.accountId)) throw new ForbiddenException('Acesso restrito ao próprio cadastro.');
    const result = this.mapper.toDTO(student);
    if (req.user.role === 'student') result.name = student.socialName || student.name;
    return result;
  }

  @Get('encontrar-por-email/:email')
  @UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
  @Roles('secretary')
  async getStudentByEmail(
    @Param('email') email: string,
  ): Promise<ViewStudentDTO> {
    return this.mapper.toDTO(await this.service.getStudentByEmail(email));
  }

  @Get('verificar/:qrcode')
  async verificarTokenQrcode(@Param('qrcode') qrcode: string): Promise<ViewStudentDTO>{
    const studentEntity = await this.service.validarTokenQrcode(qrcode)
    const dtoOutput = this.mapper.toDTO(studentEntity)
    dtoOutput.name = studentEntity.socialName || studentEntity.name;
    delete dtoOutput.socialName;
    return dtoOutput
  }


  @Post('criar')
  @UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
  @Roles('secretary')
  async createStudent(@Body() student: CreateStudentDTO) {
    return await this.service.createStudent(student);
  }

  @Delete('deletar/:ra')
  @UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
  @Roles('secretary')
  async deleteStudent(@Param('ra') ra: string) {
    return await this.service.deleteStudent(ra);
  }

 @Put('atualizar/:ra')
  @UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
  @Roles('secretary')
async updateStudent(
  @Param('ra') ra: string,
  @Body() student: UpdateStudentDto
) {
  const existing = await this.service.getStudentByRa(ra);
  const merged = this.mapper.toEntity({
    ...existing,
    ...student,
    ra,
    photo: existing.photo, // ← preserve a foto existente
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


  @Patch('remover-foto/:ra')
  async removePhoto(@Param('ra') ra: string) {
  return this.service.removePhoto(ra);
}
}
