import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  async sendVerificationCode(email: string, code: string) {
    // Apenas loga no console para teste
    console.log('\n========================================');
    console.log('📧 SIMULAÇÃO DE ENVIO DE EMAIL');
    console.log('========================================');
    console.log(`Para: ${email}`);
    console.log(`Código: ${code}`);
    console.log(`Válido por: 10 minutos`);
    console.log('========================================\n');
    
    // Simula um atraso de envio
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return { success: true };
  }
}