import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateEventFeedbackDto {
  @IsInt({ message: 'A nota deve ser um número inteiro de 1 a 5' })
  @Min(1, { message: 'A nota mínima é 1' })
  @Max(5, { message: 'A nota máxima é 5' })
  rating: number;

  @IsOptional()
  @IsString({ message: 'O comentário deve ser um texto válido' })
  @MaxLength(1000, { message: 'O comentário deve ter no máximo 1000 caracteres' })
  comments?: string;

  @IsOptional()
  @IsString({ message: 'A sugestão deve ser um texto válido' })
  @MaxLength(1000, { message: 'A sugestão deve ter no máximo 1000 caracteres' })
  suggestions?: string;
}
