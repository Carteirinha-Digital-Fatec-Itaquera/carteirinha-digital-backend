import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { StudentService } from 'src/student/student.service';

@Module({
  providers: [PrismaService],
  exports:   [PrismaService],
})
export class DatabaseModule {}
