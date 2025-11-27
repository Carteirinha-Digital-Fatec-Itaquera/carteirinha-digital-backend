import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StudentService } from 'src/student/student.service';
import { JwtService } from '@nestjs/jwt';
import { StudentMapper } from 'src/student/mapper/student.mapper';
import { SecretaryService } from 'src/secretary/secretary.service';
import { SecretaryMapper } from 'src/secretary/mapper/secretary.mapper';


@Module({
  controllers: [AuthController],
  providers: [AuthService, StudentService, JwtService, StudentMapper, SecretaryService, SecretaryMapper],
})
export class AuthModule {}
