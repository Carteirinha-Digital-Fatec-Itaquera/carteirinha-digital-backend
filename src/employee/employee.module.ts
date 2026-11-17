import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { EmployeeDataModule } from './employee-data.module';
import { EmployeeSelfController } from './employee-self.controller';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

@Module({
  imports: [DatabaseModule, AuthModule, EmployeeDataModule],
  controllers: [EmployeeSelfController, EmployeeController],
  providers: [EmployeeService, EmployeeAccountGuard, SecretaryActiveGuard],
  exports: [EmployeeService, EmployeeDataModule, EmployeeAccountGuard],
})
export class EmployeeModule {}
