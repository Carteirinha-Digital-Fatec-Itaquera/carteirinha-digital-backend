import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenPayload } from './dto/payload.dto';

interface AuthenticatedRequest {
  headers?: { authorization?: string };
  user?: TokenPayload;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Token não fornecido');
    }

    try {
      const payload: unknown = await this.jwtService.verifyAsync(token);
      if (!this.isValidPayload(payload)) {
        throw new UnauthorizedException('Token sem identidade válida');
      }
      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }

  private extractToken(request: AuthenticatedRequest): string | undefined {
    const [type, token] = request.headers?.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }

  private isValidPayload(payload: unknown): payload is TokenPayload {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as Partial<TokenPayload>;

    if (candidate.role === 'student') {
      return (
        typeof candidate.sub === 'string' &&
        candidate.sub.trim().length > 0 &&
        typeof candidate.accountId === 'string' &&
        candidate.accountId.trim().length > 0
      );
    }

    return (
      candidate.role === 'secretary' &&
      typeof candidate.sub === 'number' &&
      Number.isInteger(candidate.sub) &&
      candidate.sub > 0
    );
  }
}
