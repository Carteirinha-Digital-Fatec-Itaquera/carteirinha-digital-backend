import { Injectable } from '@nestjs/common';
import { Brevo, BrevoClient, BrevoEnvironment } from '@getbrevo/brevo';

@Injectable()
export class MailService {
  private client: BrevoClient;

  constructor() {
    this.client = new BrevoClient({
      apiKey: process.env.BREVO_API_KEY ?? '',
      environment: BrevoEnvironment.Default,
    });
  }

  async sendResetPasswordEmail(email: string, userName: string, resetLink: string) {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: 'Recuperação de Senha',
        to: [{ email }],
        sender: { name: 'Carteirinha Digital', email: 'wwluiza.09@gmail.com' },
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2>Olá, ${userName}!</h2>
            <p>Recebemos uma solicitação para redefinir a sua senha.</p>
            <a href="${resetLink}" 
               style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
               Redefinir Minha Senha
            </a>
            <p>Este link é válido por apenas 15 minutos.</p>
            <hr />
            <small>Se você não solicitou isso, ignore este e-mail.</small>
          </div>
        `,
      });
      console.log(`✅ Email de recuperação enviado para: ${email}`);
    } catch (error: any) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }
}
