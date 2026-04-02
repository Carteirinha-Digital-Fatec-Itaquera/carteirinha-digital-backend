import { Body, Controller, Get, Param, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { ViewSecretaryDTO } from './dto/view-secretary.dto';

@Controller('secretaria')
export class SecretaryController {
  constructor(
    private readonly mapper: SecretaryMapper,
    private readonly service: SecretaryService,
  ) {}

  @Get('listar-todos')
  async getSecretary(): Promise<ViewSecretaryDTO[]> {
    const data = await this.service.getSecretary();
    return this.mapper.toListDTO(data);
  }

  @Get('encontrar-por-id/:id')
  async getSecretaryById(@Param('id') id: string): Promise<ViewSecretaryDTO> {
    const data = await this.service.getSecretaryById(id);
    return this.mapper.toDTO(data);
  }

  @Post('criar')
  async createSecretary(@Body() secretary: CreateSecretaryDTO) {
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
}