import { Module } from '@nestjs/common';
import { ProjectCreditsController } from './project-credits.controller';
import { ProjectCreditsAdminController } from './project-credits-admin.controller';
import { ProjectCreditsService } from './project-credits.service';
import { ProjectCreditsAssetService } from './services/project-credits-asset.service';
import { ProjectCreditsImporter } from './importer/project-credits.importer';
import { SecretaryActiveGuard } from './guards/secretary-active.guard';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ProjectCreditsController, ProjectCreditsAdminController],
  providers: [
    ProjectCreditsService,
    ProjectCreditsAssetService,
    ProjectCreditsImporter,
    SecretaryActiveGuard,
  ],
  exports: [ProjectCreditsService, ProjectCreditsImporter],
})
export class ProjectCreditsModule {}
