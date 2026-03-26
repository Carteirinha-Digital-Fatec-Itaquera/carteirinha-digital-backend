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
  // getSecretary(): Promise<ViewSecretaryDTO[]> {
  getSecretary(): ViewSecretaryDTO[] {
    // return await this.mapper.toListDTO(this.service.getSecretary());
    return this.mapper.toListDTO(this.service.getSecretary());
  }

  @Get('encontrar-por-id/:id')
  // async getSecretaryById(@Param('id') id: number): Promise<ViewSecretaryDTO> {
  getSecretaryById(@Param('id') id: string): ViewSecretaryDTO {
    // return this.mapper.toDTO(await this.service.getSecretaryById(id));
    return this.mapper.toDTO(this.service.getSecretaryById(id));
  }

  
  // Diferença do modelo de aplicação da entidade Student
  // Diferença: Funções async ausente - aplicação sincrona
  // Falta do retorno para a aplicação, seja um erro ou algum tipo de reusltado
  // para comprovar se foi feito a operação ou não 
  @Post('criar')
  // async createSecretary(@Body() secretary: CreateSecretaryDTO) {
  createSecretary(@Body() secretary: CreateSecretaryDTO) {
    this.service.createSecretary(secretary);
    // return await this.service.createSecretary(secretary);
  }
}
