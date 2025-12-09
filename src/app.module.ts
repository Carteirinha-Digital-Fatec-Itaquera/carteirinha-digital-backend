import { Module } from '@nestjs/common';
import { StudentModule } from './student/student.module';
import { AuthModule } from './auth/auth.module';
import { SecretaryModule } from './secretary/secretary.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [StudentModule, AuthModule, SecretaryModule, DatabaseModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
