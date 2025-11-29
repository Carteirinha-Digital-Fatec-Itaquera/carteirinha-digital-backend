import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
  getSecretary(): ViewSecretaryDTO[] {
    return this.mapper.toListDTO(this.service.getSecretary());
  }

  @Get('encontrar-por-id/:id')
  getSecretaryById(@Param('id') id: string): ViewSecretaryDTO {
    return this.mapper.toDTO(this.service.getSecretaryById(id));
  }

  @Post('criar')
  createSecretary(@Body() secretary: CreateSecretaryDTO) {
    this.service.createSecretary(secretary);
  }
}
