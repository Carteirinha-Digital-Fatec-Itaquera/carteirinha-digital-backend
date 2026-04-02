import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        ciphers: 'SSLv3',
      },
    });
  }

  async sendVerificationCode(email: string, code: string) {
    try {
      const info = await this.transporter.sendMail({
        from: `"Carteirinha Digital" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 Código de Verificação - Carteirinha Digital',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <div style="text-align: center;">
              <h2 style="color: #4CAF50;">🔐 Carteirinha Digital</h2>
              <h3>Código de Verificação</h3>
            </div>
            
            <p>Olá,</p>
            <p>Você solicitou um código de verificação para acessar o sistema.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <div style="font-size: 32px; font-weight: bold; background: #f4f4f4; padding: 15px 30px; border-radius: 8px; letter-spacing: 5px; display: inline-block;">
                ${code}
              </div>
            </div>
            
            <p>Este código é válido por <strong>10 minutos</strong>.</p>
            <p>Se você não solicitou este código, ignore este email.</p>
            
            <hr style="margin: 20px 0;" />
            <p style="font-size: 12px; color: #666; text-align: center;">
              Carteirinha Digital - Sistema de Autenticação<br />
              Este é um email automático, por favor não responda.
            </p>
          </div>
        `,
      });

      console.log(`✅ Email enviado com sucesso para: ${email}`);
      console.log(`📧 Message ID: ${info.messageId}`);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Erro ao enviar email:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }
}