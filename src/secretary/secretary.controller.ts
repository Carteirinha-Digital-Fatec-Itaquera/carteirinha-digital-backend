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
}
