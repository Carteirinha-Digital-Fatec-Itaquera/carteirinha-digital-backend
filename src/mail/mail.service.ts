import { Injectable } from '@nestjs/common';
import * as SibApiV3Sdk from '@getbrevo/brevo';

@Injectable()
export class MailService {
  private apiInstance: SibApiV3Sdk.TransactionalEmailsApi;

  constructor() {
    this.apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    this.apiInstance.setApiKey(
      SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY ?? ''
    );
  }

  async sendVerificationCode(email: string, code: string) {
    try {
      const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

      sendSmtpEmail.subject = 'Código de Verificação - Carteirinha Digital Fatec';
      sendSmtpEmail.to = [{ email }];
      sendSmtpEmail.sender = { name: 'Carteirinha Digital', email: 'carteirinha.digital.fatec@gmail.com' };
      sendSmtpEmail.htmlContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 16px; overflow: hidden;">
          <div style="background-color: #CC092F; padding: 25px; text-align: center;">
            <h1 style="color: white; margin: 10px 0 5px 0; font-size: 24px;">Carteirinha Digital</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">Fatec Itaquera</p>
          </div>
          <div style="background: white; padding: 30px; text-align: center;">
            <p style="font-size: 16px; color: #333; margin: 0 0 10px 0;">Olá!</p>
            <p style="font-size: 14px; color: #666; margin: 0 0 25px 0;">Seu código de verificação é:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 12px; margin: 20px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #CC092F; font-family: monospace;">
                ${code}
              </span>
            </div>
            <p style="font-size: 13px; color: #666; margin: 20px 0 0 0;">
              ⏱️ Válido por 15 minutos | 🔒 Não compartilhe
            </p>
          </div>
          <div style="background: #f9f9f9; padding: 15px; text-align: center; border-top: 1px solid #e0e0e0;">
            <p style="font-size: 11px; color: #999; margin: 0;">
              Fatec Itaquera - Centro Paula Souza<br>
              Este é um email automático, por favor não responda.
            </p>
          </div>
        </div>
      `;

      await this.apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log(`✅ Email enviado para: ${email}`);
      return { success: true };
    } catch (error: any) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
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
    } catch (error: any) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }
}