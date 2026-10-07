import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { Secretary } from '@prisma/client';
interface CreditsRequest {
  secretary: Secretary;
}
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
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
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
  async create(@Body() dto: CreateContributorDto, @Req() req: CreditsRequest) {
    return this.service.createContributor(dto, req.secretary);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContributorDto,
    @Req() req: CreditsRequest,
  ) {
    return this.service.updateContributor(id, dto, req.secretary);
  }

  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdateContributorDto,
    @Req() req: CreditsRequest,
  ) {
    return this.service.updateContributor(id, dto, req.secretary);
  }

  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @Body() dto: PublishContributorDto,
    @Req() req: CreditsRequest,
  ) {
    return this.service.publishContributor(id, dto, req.secretary);
  }

  @Post(':id/archive')
  async archive(
    @Param('id') id: string,
    @Body() dto: ArchiveContributorDto,
    @Req() req: CreditsRequest,
  ) {
    return this.service.archiveContributor(id, dto, req.secretary);
  }

  @Post(':id/restore')
  async restore(
    @Param('id') id: string,
    @Body() dto: RestoreContributorDto,
    @Req() req: CreditsRequest,
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
  photoUploadUnavailable(): never {
    throw new ServiceUnavailableException(
      'Fotos de créditos serão disponibilizadas em uma próxima entrega.',
    );
  }

  @Get(':id/photo')
  photoPreviewUnavailable(): never {
    throw new ServiceUnavailableException(
      'Fotos de créditos serão disponibilizadas em uma próxima entrega.',
    );
  }

  @Delete(':id/photo')
  photoDeleteUnavailable(): never {
    throw new ServiceUnavailableException(
      'Fotos de créditos serão disponibilizadas em uma próxima entrega.',
    );
  }
}
