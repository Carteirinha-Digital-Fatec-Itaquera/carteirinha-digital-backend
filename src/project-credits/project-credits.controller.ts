import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ProjectCreditsService } from './project-credits.service';
import type { Request } from 'express';
import type { ProjectCreditsResponse } from './project-credits.types';

@Controller('project-credits')
export class ProjectCreditsController {
  constructor(private readonly projectCredits: ProjectCreditsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: Request): Promise<ProjectCreditsResponse> {
    return this.projectCredits.getPublicCredits(
      (
        process.env.PUBLIC_API_URL ||
        `${req.protocol}://${req.get('host')}${req.baseUrl}`
      ).replace(/\/+$/, ''),
    );
  }
  @Get(':id/photo/:token')
  @Header('Cache-Control', 'no-store')
  async photo(@Param('id') id: string, @Param('token') token: string) {
    return new StreamableFile(await this.projectCredits.getPhoto(id, token), {
      type: 'image/png',
    });
  }
}
