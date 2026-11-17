import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { TokenPayload } from '../../auth/dto/payload.dto';
import { throwEmployeeError } from '../employee.errors';
import type { EmployeeEntity } from '../entities/employee.entity';
import { EmployeeRepository } from '../repository/employee.repository';

@Injectable()
export class EmployeeAccountGuard implements CanActivate {
  constructor(private readonly employeeRepository: EmployeeRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: TokenPayload;
      employee?: EmployeeEntity;
    }>();
    const user = request.user;

    if (!user || typeof user.sub !== 'string') {
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Autenticação de funcionário necessária.',
      );
    }

    if (user.role !== 'employee') {
      throwEmployeeError(
        HttpStatus.FORBIDDEN,
        'ROLE_FORBIDDEN',
        'Apenas funcionários podem acessar este recurso.',
      );
    }

    const employee = await this.employeeRepository.findById(user.sub);
    if (!employee || employee.accountId !== user.accountId) {
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Conta de funcionário não encontrada.',
      );
    }

    if (
      employee.archivedAt !== null ||
      employee.accountStatus === 'ARCHIVED' ||
      employee.accountStatus === 'BLOCKED'
    ) {
      throwEmployeeError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_BLOCKED',
        'Conta de funcionário bloqueada ou arquivada.',
      );
    }

    if (
      typeof user.authVersion !== 'number' ||
      employee.authVersion !== user.authVersion
    ) {
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'SESSION_REVOKED',
        'Sessão revogada. Faça login novamente.',
      );
    }

    request.employee = employee;
    return true;
  }
}
