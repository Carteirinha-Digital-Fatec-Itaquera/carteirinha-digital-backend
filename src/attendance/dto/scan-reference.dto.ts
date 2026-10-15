import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PositionDto } from '../../public-events/public-events.dto';

export class ScanReferenceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PositionDto)
  position?: PositionDto;
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{10,64}$/, {
    message: 'qrReference deve ser uma referência válida',
  })
  qrReference: string;
}
