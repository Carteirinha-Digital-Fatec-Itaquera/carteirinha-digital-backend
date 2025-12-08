import { Module } from '@nestjs/common';
import { StudentModule } from './student/student.module';
import { AuthModule } from './auth/auth.module';
import { SecretaryModule } from './secretary/secretary.module';
import { QrCodeService } from './qr-code/qr-code.service';
import { QrCodeController } from './qr-code/qr-code.controller';
import { QrCodeModule } from './qr-code/qr-code.module';

@Module({
  imports: [StudentModule, AuthModule, SecretaryModule, QrCodeModule],
  controllers: [QrCodeController],
  providers: [QrCodeService],
})
export class AppModule {}
