import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendVerificationCode(email: string, code: string) {
    try {
      await this.resend.emails.send({
        from: 'Carteirinha Digital <onboarding@resend.dev>',
        to: email,
        subject: 'Código de verificação',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2>Código de verificação</h2>
            <p>Use o código abaixo para confirmar seu cadastro:</p>
            <h1 style="letter-spacing: 8px; color: #2a9d8f;">${code}</h1>
            <p>Este código é válido por <strong>10 minutos</strong>.</p>
            <hr />
            <small>Se você não solicitou isso, ignore este e-mail.</small>
          </div>
        `,
      });
      console.log(`✅ Email enviado para: ${email}`);
    } catch (error) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }

  async sendResetPasswordEmail(email: string, userName: string, resetLink: string) {
    try {
      await this.resend.emails.send({
        from: 'Carteirinha Digital <onboarding@resend.dev>',
        to: email,
        subject: 'Recuperação de Senha',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2>Olá, ${userName}!</h2>
            <p>Recebemos uma solicitação para redefinir a sua senha.</p>
            <p>Clique no botão abaixo para prosseguir:</p>
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
    } catch (error) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }
}
