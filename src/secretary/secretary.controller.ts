import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
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
  async getSecretaryById(@Param('id', ParseIntPipe) id: number): Promise<ViewSecretaryDTO> {
    return this.mapper.toDTO(await this.service.getSecretaryById(id));
  }

  @Get('encontrar-por-email/:email')
  async getSecretaryByEmail(@Param('email') email: string): Promise<ViewSecretaryDTO> {
    return this.mapper.toDTO(await this.service.getSecretaryByEmail(email));
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

