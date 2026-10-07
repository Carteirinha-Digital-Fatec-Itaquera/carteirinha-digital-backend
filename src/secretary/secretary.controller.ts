import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Patch,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TokenPayload } from '../auth/dto/payload.dto';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { ViewSecretaryDTO } from './dto/view-secretary.dto';
import { StudentService } from '../student/student.service';
import { UpdateSecretaryDto } from './dto/update-secretary.dto';

interface AuthenticatedRequest {
  user: TokenPayload;
}

@Controller('secretaria')
export class SecretaryController {
  constructor(
    private readonly mapper: SecretaryMapper,
    private readonly service: SecretaryService,
    private readonly studentService: StudentService,
  ) {}

  @Get('listar-todos')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async getSecretary(): Promise<ViewSecretaryDTO[]> {
    const data = await this.service.getSecretary();
    return this.mapper.toListDTO(data);
  }

  @Get('encontrar-por-id/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async getSecretaryById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ViewSecretaryDTO> {
    return this.mapper.toDTO(await this.service.getSecretaryById(id));
  }

  @Get('encontrar-por-email/:email')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async getSecretaryByEmail(
    @Param('email') email: string,
  ): Promise<ViewSecretaryDTO> {
    return this.mapper.toDTO(await this.service.getSecretaryByEmail(email));
  }

  @Post('criar')
  async createSecretary(@Body() secretary: CreateSecretaryDTO) {
    return await this.service.createSecretary(secretary);
  }

  @Post('confirmar-cadastro')
  async confirmSecretary(
    @Body()
    body: {
      email: string;
      code: string;
      secretary: CreateSecretaryDTO;
    },
  ) {
    return await this.service.confirmSecretary(
      body.email,
      body.code,
      body.secretary,
    );
  }

  @Put('atualizar/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async updateSecretary(
    @Param('id', ParseIntPipe) id: number,
    @Body() secretary: UpdateSecretaryDto,
    @Request() request: AuthenticatedRequest,
  ) {
    if (Number(request.user.sub) !== id) {
      throw new ForbiddenException(
        'Apenas a própria secretária pode atualizar seus dados cadastrais',
      );
    }
    return await this.service.updateSecretaryFromDto(id, secretary);
  }

  @Delete('deletar/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async deleteSecretary(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: AuthenticatedRequest,
  ) {
    if (Number(request.user.sub) !== id) {
      throw new ForbiddenException(
        'Apenas a própria secretária pode deletar sua conta',
      );
    }
    return await this.service.deleteSecretary(id);
  }

  @Post('upload-alunos')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAlunos(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado');
    }

    const nomeArquivo = file.originalname.toLowerCase();

    // NOVO SUPORTE XLSX/XLS
    if (nomeArquivo.endsWith('.xlsx') || nomeArquivo.endsWith('.xls')) {
      return this.service.processarAlunosXLSX(file.buffer);
    }

    if (nomeArquivo.endsWith('.csv')) {
      return this.service.processarAlunosCSV(file.buffer);
    }

    if (nomeArquivo.endsWith('.txt')) {
      return this.service.processarAlunosTXT(file.buffer);
    }

    if (nomeArquivo.endsWith('.pdf')) {
      return this.service.processarAlunosPDF(file.buffer);
    }

    throw new BadRequestException(
      'Formato não suportado. Use XLSX, CSV, TXT ou PDF',
    );
  }

  @Get('fotos-pendentes')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async getPendingPhotos() {
    return this.studentService.getPendingPhotos();
  }

  @Patch('aprovar-foto/:ra')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('secretary')
  async approvePhoto(
    @Param('ra') ra: string,
    @Body()
    body: {
      status: string;
      rejectionReason?: string;
    },
  ) {
    console.log('RA recebido:', ra);
    console.log('Body recebido:', body);

    if (!body || !body.status) {
      throw new BadRequestException('Status é obrigatório');
    }

    return this.studentService.approvePhoto(
      ra,
      body.status,
      body.rejectionReason || null,
      'secretaria',
    );
  }
}
