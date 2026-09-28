import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StudentService } from 'src/student/student.service';
import { StudentMapper } from 'src/student/mapper/student.mapper';
import { SecretaryService } from 'src/secretary/secretary.service';
import { SecretaryMapper } from 'src/secretary/mapper/secretary.mapper';
import { StudentRepository } from 'src/student/repository/student.repository';
import { PrismaStudentRepository } from 'src/student/repository/prisma/prisma.student.repository';
import { SecretaryRepository } from 'src/secretary/repository/secretary.repository';
import { PrismaSecretaryRepository } from 'src/secretary/repository/prisma/prisma.secretary.repository';
import { PrismaService } from 'src/database/prisma.service';
import { UtilsModule } from 'src/utils/utilsModule';
import { VerificationModule } from '../verification/verification.module';
import { VerificationService } from '../verification/verification.service';
import { MailModule } from '../mail/mail.module';
import { UploadModule } from '../upload/upload.module';
import { UploadService } from '../upload/upload.service';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { loadAuthSecrets } from './auth.config';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const { jwtSecret } = loadAuthSecrets();
        return {
          secret: jwtSecret,
          signOptions: { expiresIn: '1h' },
        };
      },
    }),
    UtilsModule,
    VerificationModule,
    MailModule,
    UploadModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    UploadService,
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
    {
      provide: SecretaryRepository,
      useClass: PrismaSecretaryRepository,
    },
  ],
  exports: [AuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
