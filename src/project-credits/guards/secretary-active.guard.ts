import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SecretaryActiveGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new UnauthorizedException('Acesso restrito à Secretaria.');
    }

    if (user.role !== 'secretary') {
      throw new ForbiddenException(
        'Apenas secretárias têm permissão para acessar este recurso.',
      );
    }

    const secretaryId = Number(user.sub);
    if (isNaN(secretaryId)) {
      throw new UnauthorizedException('Identificador de secretária inválido.');
    }

    const secretary = await this.prisma.secretary.findUnique({
      where: { id: secretaryId },
    });

    if (!secretary) {
      throw new UnauthorizedException(
        'Conta de secretária não encontrada ou inativa no sistema.',
      );
    }

    if (new Date() > new Date(secretary.dueDate)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Renovação periódica de senha obrigatória.',
        code: 'PASSWORD_RENEWAL_REQUIRED',
      });
    }

    request.secretary = secretary;
    return true;
  }
}
