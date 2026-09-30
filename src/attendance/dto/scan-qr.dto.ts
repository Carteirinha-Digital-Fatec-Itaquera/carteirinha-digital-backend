import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ScanQrDto {
  @IsString()
  @IsNotEmpty()
  @IsJWT()
  @MaxLength(8192)
  qrToken!: string;
}
