import { Injectable } from '@nestjs/common';
const SibApiV3Sdk = require('@getbrevo/brevo');

@Injectable()
export class MailService {
  private apiInstance: any;

  constructor() {
    const apiKey = SibApiV3Sdk.ApiClient.instance.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY;
    this.apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  }

  async sendResetPasswordEmail(email: string, userName: string, resetLink: string) {
    try {
      const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
      sendSmtpEmail.subject = 'Recuperação de Senha';
      sendSmtpEmail.to = [{ email }];
      sendSmtpEmail.sender = { name: 'Carteirinha Digital', email: 'carteirinha.digital.fatec@gmail.com' };
      sendSmtpEmail.htmlContent = `
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
      `;

      await this.apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log(`✅ Email de recuperação enviado para: ${email}`);
    } catch (error) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }
}