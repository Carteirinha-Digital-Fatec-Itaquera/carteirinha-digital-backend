import { Module } from '@nestjs/common';
import { StudentModule } from './student/student.module';
import { AuthModule } from './auth/auth.module';
import { SecretaryModule } from './secretary/secretary.module';

@Module({
  imports: [StudentModule, AuthModule, SecretaryModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
