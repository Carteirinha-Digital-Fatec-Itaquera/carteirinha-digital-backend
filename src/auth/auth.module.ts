import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // <-- ADICIONA
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StudentService } from 'src/student/student.service';
import { StudentMapper } from 'src/student/mapper/student.mapper';
import { SecretaryService } from 'src/secretary/secretary.service';
import { SecretaryMapper } from 'src/secretary/mapper/secretary.mapper';
import { StudentRepository } from 'src/student/repository/student.repository';
import { PrismaStudentRepository } from 'src/student/repository/prisma/prisma.student.repository';
import { PrismaService } from 'src/database/prisma.service';
import { VerificationModule } from '../verification/verification.module';
import { VerificationService } from '../verification/verification.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    VerificationModule,
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    StudentService,
    StudentMapper,
    SecretaryService,
    SecretaryMapper,
    PrismaService,
    VerificationService,
    {
      provide: StudentRepository,
      useClass: PrismaStudentRepository,
    },
  ],
})
export class AuthModule {}