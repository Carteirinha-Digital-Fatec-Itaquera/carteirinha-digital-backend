import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CertificateModule } from '../certificate/certificate.module';
import { MailModule } from '../mail/mail.module';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { EventAssetsModule } from './event-assets.module';
import { EventModule } from '../event/event.module';
import { VisitorService } from './visitor.service';
import { EventCatalogService } from './event-catalog.service';
import { EventOperationsService } from './event-operations.service';
import { EventJobsService } from './event-jobs.service';
import {
  EventManagementController,
  PublicEventsController,
  StudentLocationController,
  VisitorController,
} from './public-events.controller';
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    AttendanceModule,
    CertificateModule,
    MailModule,
    EventAssetsModule,
    EventModule,
  ],
  controllers: [
    EventManagementController,
    PublicEventsController,
    VisitorController,
    StudentLocationController,
  ],
  providers: [
    VisitorService,
    EventCatalogService,
    EventOperationsService,
    EventJobsService,
    SecretaryActiveGuard,
  ],
})
export class PublicEventsModule {}
