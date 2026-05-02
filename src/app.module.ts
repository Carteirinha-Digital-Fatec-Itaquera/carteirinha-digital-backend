import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { StudentModule } from './student/student.module';
import { AuthModule } from './auth/auth.module';
import { SecretaryModule } from './secretary/secretary.module';
import { DatabaseModule } from './database/database.module';
import { VerificationModule } from './verification/verification.module';
import { ServeStaticModule } from '@nestjs/serve-static'; // 👈 Importe isso
import { join } from 'path';

@Module({
  imports: [
    StudentModule, 
    AuthModule, 
    SecretaryModule, 
    DatabaseModule, 
    VerificationModule,

    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads/', 
    }),
    
    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',  // ou 'smtp.office365.com' para Outlook
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      },
      defaults: {
        from: `"Carteirinha Digital" <${process.env.EMAIL_USER}>`,
      },
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}