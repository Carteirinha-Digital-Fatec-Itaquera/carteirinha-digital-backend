import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ScanReferenceDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{10,64}$/, {
    message: 'qrReference deve ser uma referência válida',
  })
  qrReference: string;
}
