import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StudentService } from 'src/student/student.service';
import { JwtService } from '@nestjs/jwt';
import { StudentMapper } from 'src/student/mapper/student.mapper';
import { SecretaryService } from 'src/secretary/secretary.service';
import { SecretaryMapper } from 'src/secretary/mapper/secretary.mapper';
import { StudentRepository } from 'src/student/repository/student.repository';
import { PrismaStudentRepository } from 'src/student/repository/prisma/prisma.student.repository';
import { SecretaryRepository } from 'src/secretary/repository/secretary.repository';
import { PrismaSecretaryRepository } from 'src/secretary/repository/prisma/prisma.secretary.repository';
import { PrismaService } from 'src/database/prisma.service';
import { HashContentService } from 'src/utils/hashContentService';
import { JwtModule } from '@nestjs/jwt';
// import { HashContentService } from 'src/utils/hashContent';
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'SUPER_SECRET_KEY', // 👈 must have a value
      signOptions: { expiresIn: '1h' }, // optional
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    StudentService, 
    // JwtService,
    StudentMapper,
    SecretaryService,
    SecretaryMapper,
    PrismaService,
    HashContentService,
    {
      provide: StudentRepository,
      useClass: PrismaStudentRepository,
    },
    {
      provide: SecretaryRepository,
      useClass: PrismaSecretaryRepository,
    },
  ],
})
export class AuthModule {}
