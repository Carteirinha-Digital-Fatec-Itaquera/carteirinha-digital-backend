import { Injectable } from '@nestjs/common';

// TODO: Ajustar envio de email real
// Opções: Gmail (senha de app), Outlook (senha de app) ou Resend (API key)
// Por enquanto, mock exibe o código no terminal

@Injectable()
export class MailService {
  async sendVerificationCode(email: string, code: string) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    📧 CÓDIGO DE VERIFICAÇÃO                  ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Para: ${email.padEnd(43)}║`);
    console.log(`║ Código: ${code.padEnd(41)}║`);
    console.log(`║ Válido por: 10 minutos${' '.padEnd(29)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    return { success: true };
  }
}