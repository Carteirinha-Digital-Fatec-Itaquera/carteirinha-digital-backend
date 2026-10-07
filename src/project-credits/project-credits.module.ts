import { Module } from '@nestjs/common';
import { ProjectCreditsController } from './project-credits.controller';
import { ProjectCreditsService } from './project-credits.service';

@Module({
  controllers: [ProjectCreditsController],
  providers: [ProjectCreditsService],
})
export class ProjectCreditsModule {}
