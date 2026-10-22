import { Injectable } from '@nestjs/common';
import { BrevoClient, BrevoEnvironment } from '@getbrevo/brevo';

@Injectable()
export class MailService {
  private client: BrevoClient;

  constructor() {
    this.client = new BrevoClient({
      apiKey: process.env.BREVO_API_KEY ?? '',
      environment: BrevoEnvironment.Default,
    });
  }

  async sendVisitorCode(email: string, code: string) {
    await this.client.transactionalEmails.sendTransacEmail({
      subject: 'Seu acesso aos eventos da Fatec Itaquera', to: [{ email }],
      sender: { name: 'Carteirinha Digital', email: process.env.EVENT_MAIL_SENDER || 'carteirinha.digital.fatec@gmail.com' },
      textContent: `Seu código de acesso é ${code}. Válido por 10 minutos. Não compartilhe. Este acesso não cria uma conta de aluno.`,
    });
  }

  async sendVisitorCertificate(email: string, url: string) {
    await this.client.transactionalEmails.sendTransacEmail({
      subject: 'Seu certificado está disponível - Fatec Itaquera', to: [{ email }],
      sender: { name: 'Carteirinha Digital', email: process.env.EVENT_MAIL_SENDER || 'carteirinha.digital.fatec@gmail.com' },
      textContent: `Seu certificado está disponível. Acesse a área de visitante para baixar seu documento: ${url}\nBaixe seu documento dentro do período informado pela organização.`,
    });
  }

  async sendCertificateNotification(params: {
    email: string;
    recipientName: string;
    eventTitle: string;
    accessUrl: string;
    profile: 'ALUNO' | 'VISITANTE';
  }) {
    const subject = `Seu certificado está disponível: ${params.eventTitle} - Fatec Itaquera`;
    const instructions =
      params.profile === 'ALUNO'
        ? 'Acesse a área de certificados na Carteirinha Digital para visualizar ou baixar seu certificado oficial.'
        : 'Acesse a área de visitantes com seu CPF cadastrado para visualizar ou baixar seu certificado durante o período de retenção da edição.';

    await this.client.transactionalEmails.sendTransacEmail({
      subject,
      to: [{ email: params.email, name: params.recipientName }],
      sender: {
        name: 'Carteirinha Digital - Fatec Itaquera',
        email: process.env.EVENT_MAIL_SENDER || 'carteirinha.digital.fatec@gmail.com',
      },
      htmlContent: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 16px; overflow: hidden;">
          <div style="background-color: #CC092F; padding: 25px; text-align: center;">
            <h1 style="color: white; margin: 10px 0 5px 0; font-size: 22px;">Certificado Disponível</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">Fatec Itaquera — Professor Miguel Reale</p>
          </div>
          <div style="background: white; padding: 30px;">
            <p style="font-size: 16px; color: #333; margin: 0 0 10px 0;">Olá, <strong>${params.recipientName}</strong>!</p>
            <p style="font-size: 14px; color: #555; line-height: 1.6;">
              Sua participação na atividade <strong>"${params.eventTitle}"</strong> foi confirmada e o seu certificado de participação já se encontra emitido e disponível para consulta.
            </p>
            <p style="font-size: 14px; color: #666; margin: 20px 0;">
              ${instructions}
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${params.accessUrl}" 
                 style="background-color: #CC092F; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">
                Acessar Meus Certificados
              </a>
            </div>
            <p style="font-size: 12px; color: #888; text-align: center;">
              Por segurança, este e-mail contém apenas o link para acesso seguro à sua área oficial. Nenhum anexo em PDF ou chave confidencial é transmitido por e-mail.
            </p>
          </div>
          <div style="background: #f9f9f9; padding: 15px; text-align: center; border-top: 1px solid #e0e0e0;">
            <p style="font-size: 11px; color: #999; margin: 0;">
              Fatec Itaquera — Centro Paula Souza<br>
              Este é um e-mail automático do sistema de eventos.
            </p>
          </div>
        </div>
      `,
      textContent: `Olá, ${params.recipientName}!\n\nSua participação na atividade "${params.eventTitle}" foi confirmada e seu certificado já está disponível.\n\n${instructions}\n\nAcesse seus certificados pelo link seguro:\n${params.accessUrl}\n\nFatec Itaquera - Centro Paula Souza`,
    });
  }

  async sendVerificationCode(email: string, code: string) {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: 'Código de Verificação - Carteirinha Digital Fatec',
        to: [{ email }],
        sender: { name: 'Carteirinha Digital', email: 'carteirinha.digital.fatec@gmail.com' },
        htmlContent: `
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
        `,
      });
      console.log(`✅ Email enviado para: ${email}`);
      return { success: true };
    } catch (error: any) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }

  async sendResetPasswordEmail(email: string, userName: string, resetLink: string) {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: 'Recuperação de Senha',
        to: [{ email }],
        sender: { name: 'Carteirinha Digital', email: 'carteirinha.digital.fatec@gmail.com' },
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
