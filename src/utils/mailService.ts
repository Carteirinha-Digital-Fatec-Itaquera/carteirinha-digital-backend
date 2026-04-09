import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST, // Ex: smtp.gmail.com
      port: Number(process.env.MAIL_PORT),
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  async sendResetPasswordEmail(email: string, resetLink: string, userName: string) {
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>Olá, ${userName}!</h2>
        <p>Recebemos uma solicitação para redefinir a senha da sua Carteirinha Digital.</p>
        <p>Clique no botão abaixo para prosseguir:</p>
        <a href="${resetLink}" 
           style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
           Redefinir Minha Senha
        </a>
        <p>Este link é válido por apenas 15 minutos.</p>
        <hr />
        <small>Se você não solicitou isso, ignore este e-mail.</small>
      </div>
    `;

    await this.transporter.sendMail({
      from: '"Carteirinha Digital" <no-reply@suaapp.com>',
      to: email,
      subject: 'Recuperação de Senha',
      html: htmlBody,
    });
  }
}