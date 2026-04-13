import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  async sendVerificationCode(email: string, code: string) {
    try {
      await this.transporter.sendMail({
        from: `"Carteirinha Digital - Fatec" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Código de Verificação - Carteirinha Digital Fatec',
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 16px; overflow: hidden;">
            
            <!-- Cabeçalho Vermelho Fatec -->
            <div style="background-color: #CC092F; padding: 25px; text-align: center;">
              <div style="font-size: 40px;">🎓</div>
              <h1 style="color: white; margin: 10px 0 5px 0; font-size: 24px;">Carteirinha Digital</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">Fatec Itaquera</p>
            </div>
            
            <!-- Conteúdo Branco -->
            <div style="background: white; padding: 30px; text-align: center;">
              <p style="font-size: 16px; color: #333; margin: 0 0 10px 0;">Olá, estudante!</p>
              <p style="font-size: 14px; color: #666; margin: 0 0 25px 0;">Seu código de verificação é:</p>
              
              <div style="background: #f5f5f5; padding: 20px; border-radius: 12px; margin: 20px 0;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #CC092F; font-family: monospace;">
                  ${code}
                </span>
              </div>
              
              <p style="font-size: 13px; color: #666; margin: 20px 0 0 0;">
                ⏱️ Válido por 10 minutos | 🔒 Não compartilhe
              </p>
            </div>
            
            <!-- Rodapé -->
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
    } catch (error) {
      console.error('❌ Erro:', error);
      throw new Error(`Não foi possível enviar o email: ${error.message}`);
    }
  }
}