import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put ,Patch, UseInterceptors, UploadedFile, BadRequestException} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { ViewSecretaryDTO } from './dto/view-secretary.dto';
import { StudentService } from '../student/student.service'; 

@Controller('secretaria')
export class SecretaryController {
  constructor(
    private readonly mapper: SecretaryMapper,
    private readonly service: SecretaryService,
    private readonly studentService: StudentService, 
  ) {}

  @Get('listar-todos')
  async getSecretary(): Promise<ViewSecretaryDTO[]> {
    const data = await this.service.getSecretary();
    return this.mapper.toListDTO(data);
  }

  @Get('encontrar-por-id/:id')
  async getSecretaryById(@Param('id', ParseIntPipe) id: number): Promise<ViewSecretaryDTO> {
    return this.mapper.toDTO(await this.service.getSecretaryById(id));
  }

  @Get('encontrar-por-email/:email')
  async getSecretaryByEmail(@Param('email') email: string): Promise<ViewSecretaryDTO> {
    return this.mapper.toDTO(await this.service.getSecretaryByEmail(email));
    
  async getSecretaryById(@Param('id') id: string): Promise<ViewSecretaryDTO> {
    const data = await this.service.getSecretaryById(id);
    return this.mapper.toDTO(data);
  }

  @Post('criar')
  async createSecretary(@Body() secretary: CreateSecretaryDTO) {
    return await this.service.createSecretary(secretary);
  }

  @Put('atualizar/:id')
  async updateSecretary(@Param('id', ParseIntPipe) id: number, @Body() secretary: CreateSecretaryDTO) {
    return await this.service.updateSecretary(this.mapper.toEntity({ ...secretary, id }));
  }

  @Delete('deletar/:id')
  async deleteSecretary(@Param('id', ParseIntPipe) id: number) {
    return await this.service.deleteSecretary(id);
  }
}

    const data = await this.service.createSecretary(secretary);
    return this.mapper.toDTO(data);
  }

  @Post('upload-alunos')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAlunos(@UploadedFile() file: any) {  
    if (!file) {
      throw new BadRequestException('Arquivo não enviado');
    }

    const nomeArquivo = file.originalname.toLowerCase();
    
    if (nomeArquivo.endsWith('.csv')) {
      return this.service.processarAlunosCSV(file.buffer);
    } 
    
    if (nomeArquivo.endsWith('.txt')) {
      return this.service.processarAlunosTXT(file.buffer);
    }
    
    if (nomeArquivo.endsWith('.pdf')) {
      return this.service.processarAlunosPDF(file.buffer);
    }
    
    throw new BadRequestException('Formato não suportado. Use CSV, TXT ou PDF');
  }


  @Get('fotos-pendentes')
  async getPendingPhotos() {
    return this.studentService.getPendingPhotos();
  }

 @Patch('aprovar-foto/:ra')
async approvePhoto(
  @Param('ra') ra: string,
  @Body() body: { status: string; rejectionReason?: string }
) {
  console.log('RA recebido:', ra);
  console.log('Body recebido:', body);
  
  if (!body || !body.status) {
    throw new BadRequestException('Status é obrigatório');
  }
  
  return this.studentService.approvePhoto(ra, body.status, body.rejectionReason || null, 'secretaria');
}
}
