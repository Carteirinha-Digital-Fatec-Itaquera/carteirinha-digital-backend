import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelEventDto {
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
  reason: string;
}
