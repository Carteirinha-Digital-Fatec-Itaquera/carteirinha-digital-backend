import { Module } from '@nestjs/common';
import { StudentModule } from './student/student.module';
import { AuthModule } from './auth/auth.module';
import { SecretaryModule } from './secretary/secretary.module';
import { DatabaseModule } from './database/database.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [StudentModule, AuthModule, SecretaryModule, DatabaseModule, VerificationModule],
  controllers: [],
  providers: [],
})
export class AppModule {}