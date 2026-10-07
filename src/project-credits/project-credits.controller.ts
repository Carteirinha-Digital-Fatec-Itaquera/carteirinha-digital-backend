import { Controller, Get, Header } from '@nestjs/common';
import { ProjectCreditsService } from './project-credits.service';
import type { ProjectCreditsResponse } from './project-credits.types';

@Controller('project-credits')
export class ProjectCreditsController {
  constructor(private readonly projectCredits: ProjectCreditsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list(): ProjectCreditsResponse {
    return this.projectCredits.listPublicCredits();
  }
}
