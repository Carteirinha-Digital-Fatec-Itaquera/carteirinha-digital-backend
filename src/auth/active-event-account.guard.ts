import { ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import type { TokenPayload } from './dto/payload.dto';
/** AuthGuard/RolesGuard run first; student identity is checked by its domain service. */
@Injectable()
export class ActiveEventAccountGuard extends SecretaryActiveGuard {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
  async canActivate(context: ExecutionContext) {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: TokenPayload }>().user;
    return user?.role === 'student' ? true : super.canActivate(context);
  }
}
