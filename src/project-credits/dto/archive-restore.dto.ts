import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ArchiveContributorDto {
  @IsInt({ message: 'expectedVersion deve ser um número inteiro' })
  @Min(1, { message: 'expectedVersion deve ser pelo menos 1' })
  expectedVersion: number;

  @IsOptional()
  @IsString()
  @MaxLength(255, {
    message: 'O motivo do arquivamento não pode exceder 255 caracteres',
  })
  reason?: string;
}

export class RestoreContributorDto {
  @IsInt({ message: 'expectedVersion deve ser um número inteiro' })
  @Min(1, { message: 'expectedVersion deve ser pelo menos 1' })
  expectedVersion: number;
}
