import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  speaker?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  workloadMinutes?: number;

  @IsOptional()
  @IsBoolean()
  certificateEnabled?: boolean;

  @IsOptional()
  @IsIn(['CANCELLED'])
  status?: 'CANCELLED';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Motivo do cancelamento deve ser um texto' })
  @MinLength(3, {
    message: 'Motivo do cancelamento deve ter pelo menos 3 caracteres',
  })
  @MaxLength(1000, {
    message: 'Motivo do cancelamento deve ter no máximo 1000 caracteres',
  })
  cancelReason?: string;
}
