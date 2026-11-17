import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmployeeEligibilityService } from './employee-eligibility.service';
import { EmployeeMapper } from './mapper/employee.mapper';
import { EmployeeRepository } from './repository/employee.repository';
import { PrismaEmployeeRepository } from './repository/prisma/prisma.employee.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    EmployeeEligibilityService,
    EmployeeMapper,
    {
      provide: EmployeeRepository,
      useClass: PrismaEmployeeRepository,
    },
  ],
  exports: [EmployeeEligibilityService, EmployeeMapper, EmployeeRepository],
})
export class EmployeeDataModule {}
