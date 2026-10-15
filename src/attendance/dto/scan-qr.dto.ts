import {
  IsJWT,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PositionDto } from '../../public-events/public-events.dto';

export class ScanQrDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PositionDto)
  position?: PositionDto;
  @IsString()
  @IsNotEmpty()
  @IsJWT()
  @MaxLength(8192)
  qrToken!: string;
}
