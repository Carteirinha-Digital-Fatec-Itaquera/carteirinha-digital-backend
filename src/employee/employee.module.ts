import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { UtilsModule } from '../utils/utilsModule';
import { EmployeeAuthController } from './employee-auth.controller';
import { EmployeeAuthService } from './employee-auth.service';
import { EmployeeDataModule } from './employee-data.module';
import { EmployeeSelfController } from './employee-self.controller';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

@Module({
  imports: [DatabaseModule, AuthModule, EmployeeDataModule, MailModule, UtilsModule],
  controllers: [EmployeeAuthController, EmployeeSelfController, EmployeeController],
  providers: [
    EmployeeService,
    EmployeeAuthService,
    EmployeeAccountGuard,
    SecretaryActiveGuard,
  ],
  exports: [EmployeeService, EmployeeAuthService, EmployeeDataModule, EmployeeAccountGuard],
})
export class EmployeeModule {}
