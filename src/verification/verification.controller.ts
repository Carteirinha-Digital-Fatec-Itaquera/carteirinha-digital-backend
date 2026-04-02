import { Controller, Post, Body } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { SendCodeDto } from './dto/send-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

@Controller('verificacao')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('enviar')
  async sendCode(@Body() sendCodeDto: SendCodeDto) {
    return this.verificationService.sendCode(sendCodeDto.email);
  }

  @Post('validar')
  async verifyCode(@Body() verifyCodeDto: VerifyCodeDto) {
    return this.verificationService.verifyCode(
      verifyCodeDto.email,
      verifyCodeDto.code,
    );
  }
}