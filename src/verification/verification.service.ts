import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class VerificationService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async sendCode(email: string) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await this.prisma.verificationCode.create({
      data: {
        email,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        used: false,
      },
    });

    await this.mailService.sendVerificationCode(email, code);

    return { message: 'Código enviado com sucesso' };
  }

  async verifyCode(email: string, code: string): Promise<boolean> {
  console.log('🔍 Buscando:', { email, code });
  
  const verificationCode = await this.prisma.verificationCode.findFirst({
    where: {
      email,
      code,
      used: false,
      expiresAt: { gt: new Date() },
    },
  });

  console.log('🔍 Encontrado:', verificationCode);
  console.log('🔍 Data atual:', new Date());
  console.log('🔍 Expira em:', verificationCode?.expiresAt);

  if (!verificationCode) {
    return false;
  }

  await this.prisma.verificationCode.update({
    where: { id: verificationCode.id },
    data: { used: true },
  });

  return true;
}
}