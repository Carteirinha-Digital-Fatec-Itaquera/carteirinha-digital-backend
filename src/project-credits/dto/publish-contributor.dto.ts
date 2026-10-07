import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class PublishContributorDto {
  @IsInt({ message: 'expectedVersion deve ser um número inteiro' })
  @Min(1, { message: 'expectedVersion deve ser pelo menos 1' })
  expectedVersion: number;

  @IsBoolean({ message: 'A confirmação do perfil é obrigatória para publicar' })
  profileConfirmed: boolean;

  @IsOptional()
  @IsBoolean()
  photoConfirmed?: boolean;
}
