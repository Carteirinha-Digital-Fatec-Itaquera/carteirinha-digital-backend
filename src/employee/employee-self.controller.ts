import {
  Controller,
  Get,
  Header,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { EmployeeService } from './employee.service';
import type { EmployeeEntity } from './entities/employee.entity';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

interface EmployeeRequest {
  employee: EmployeeEntity;
}

@Controller('funcionarios/me')
@UseGuards(AuthGuard, EmployeeAccountGuard)
export class EmployeeSelfController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  getMe(@Req() req: EmployeeRequest) {
    return this.employeeService.getMe(req.employee.id);
  }

  @Get('carteirinha')
  @Header('Cache-Control', 'no-store')
  getCredentialCard(@Req() req: EmployeeRequest) {
    return this.employeeService.getMyCredentialCard(req.employee.id);
  }
}
