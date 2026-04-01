import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class VerificationService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async sendCode(email: string) {
    // Gera código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Salva no banco
    await this.prisma.verificationCode.create({
      data: {
        email,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutos
        used: false,
      },
    });

    // Envia email
    await this.mailService.sendVerificationCode(email, code);
    
    return { message: 'Código enviado com sucesso' };
  }

  async verifyCode(email: string, code: string) {
    // Busca código válido
    const verificationCode = await this.prisma.verificationCode.findFirst({
      where: {
        email,
        code,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      throw new BadRequestException('Código inválido ou expirado');
    }

    // Marca como usado
    await this.prisma.verificationCode.update({
      where: { id: verificationCode.id },
      data: { used: true },
    });

    return { verified: true };
  }
}