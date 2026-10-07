import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SecretaryActiveGuard } from './guards/secretary-active.guard';
import { ProjectCreditsService } from './project-credits.service';
import { CreateContributorDto } from './dto/create-contributor.dto';
import { UpdateContributorDto } from './dto/update-contributor.dto';
import { PublishContributorDto } from './dto/publish-contributor.dto';
import {
  ArchiveContributorDto,
  RestoreContributorDto,
} from './dto/archive-restore.dto';
import { AdminQueryContributorsDto } from './dto/admin-query.dto';

@Controller('project-credits/admin/contributors')
@UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
@Roles('secretary')
export class ProjectCreditsAdminController {
  constructor(private readonly service: ProjectCreditsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Query() query: AdminQueryContributorsDto) {
    return this.service.listContributorsAdmin(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async getOne(@Param('id') id: string) {
    return this.service.getContributorAdmin(id);
  }

  @Post()
  async create(@Body() dto: CreateContributorDto, @Req() req: any) {
    return this.service.createContributor(dto, req.secretary);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContributorDto,
    @Req() req: any,
  ) {
    return this.service.updateContributor(id, dto, req.secretary);
  }

  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @Body() dto: PublishContributorDto,
    @Req() req: any,
  ) {
    return this.service.publishContributor(id, dto, req.secretary);
  }

  @Post(':id/archive')
  async archive(
    @Param('id') id: string,
    @Body() dto: ArchiveContributorDto,
    @Req() req: any,
  ) {
    return this.service.archiveContributor(id, dto, req.secretary);
  }

  @Post(':id/restore')
  async restore(
    @Param('id') id: string,
    @Body() dto: RestoreContributorDto,
    @Req() req: any,
  ) {
    return this.service.restoreContributor(id, dto, req.secretary);
  }

  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  async history(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.getAuditHistory(id, page, limit);
  }

  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('expectedVersion') expectedVersionStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo de imagem não fornecido.');
    }
    const expectedVersion = Number(expectedVersionStr);
    if (isNaN(expectedVersion) || expectedVersion < 1) {
      throw new BadRequestException(
        'expectedVersion deve ser um número inteiro válido.',
      );
    }
    return this.service.uploadPhoto(id, file, expectedVersion, req.secretary);
  }

  @Get(':id/photo')
  @Header('Cache-Control', 'no-store')
  async getPhotoPreview(@Param('id') id: string) {
    return this.service.getPhotoPreview(id);
  }

  @Delete(':id/photo')
  async deletePhoto(
    @Param('id') id: string,
    @Body('expectedVersion') expectedVersionStr: string,
    @Req() req: any,
  ) {
    const expectedVersion = Number(expectedVersionStr);
    if (isNaN(expectedVersion) || expectedVersion < 1) {
      throw new BadRequestException(
        'expectedVersion deve ser um número inteiro válido.',
      );
    }
    return this.service.deletePhoto(id, expectedVersion, req.secretary);
  }
}
