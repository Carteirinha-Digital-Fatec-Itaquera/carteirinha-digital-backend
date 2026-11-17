import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { UploadModule } from '../upload/upload.module';
import { UtilsModule } from '../utils/utilsModule';
import { EmployeeAuthController } from './employee-auth.controller';
import { EmployeeAuthService } from './employee-auth.service';
import { EmployeeDataModule } from './employee-data.module';
import { EmployeeImportWorkerService } from './employee-import-worker.service';
import { EmployeeImportController } from './employee-import.controller';
import { EmployeeImportService } from './employee-import.service';
import { EmployeeMaintenanceService } from './employee-maintenance.service';
import { EmployeePhotoController } from './employee-photo.controller';
import { EmployeePhotoService } from './employee-photo.service';
import { EmployeePublicController } from './employee-public.controller';
import { EmployeeSelfController } from './employee-self.controller';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    EmployeeDataModule,
    MailModule,
    UtilsModule,
    UploadModule,
  ],
  controllers: [
    EmployeeAuthController,
    EmployeePublicController,
    EmployeeSelfController,
    EmployeePhotoController,
    EmployeeImportController,
    EmployeeController,
  ],
  providers: [
    EmployeeService,
    EmployeeAuthService,
    EmployeePhotoService,
    EmployeeImportService,
    EmployeeImportWorkerService,
    EmployeeMaintenanceService,
    EmployeeAccountGuard,
    SecretaryActiveGuard,
  ],
  exports: [
    EmployeeService,
    EmployeeAuthService,
    EmployeePhotoService,
    EmployeeImportService,
    EmployeeDataModule,
    EmployeeAccountGuard,
  ],
})
export class EmployeeModule {}
