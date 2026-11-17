import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { UtilsModule } from '../utils/utilsModule';
import { EmployeeAuthController } from './employee-auth.controller';
import { EmployeeAuthService } from './employee-auth.service';
import { EmployeeDataModule } from './employee-data.module';
import { EmployeeImportWorkerService } from './employee-import-worker.service';
import { EmployeeImportController } from './employee-import.controller';
import { EmployeeImportService } from './employee-import.service';
import { EmployeeMaintenanceService } from './employee-maintenance.service';
import { EmployeeSelfController } from './employee-self.controller';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

@Module({
  imports: [DatabaseModule, AuthModule, EmployeeDataModule, MailModule, UtilsModule],
  controllers: [
    EmployeeAuthController,
    EmployeeSelfController,
    EmployeeImportController,
    EmployeeController,
  ],
  providers: [
    EmployeeService,
    EmployeeAuthService,
    EmployeeImportService,
    EmployeeImportWorkerService,
    EmployeeMaintenanceService,
    EmployeeAccountGuard,
    SecretaryActiveGuard,
  ],
  exports: [
    EmployeeService,
    EmployeeAuthService,
    EmployeeImportService,
    EmployeeDataModule,
    EmployeeAccountGuard,
  ],
})
export class EmployeeModule {}
