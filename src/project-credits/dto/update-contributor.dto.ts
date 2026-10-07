import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ContributorLinkInputDto,
  ContributorParticipationInputDto,
} from './create-contributor.dto';

export class UpdateContributorDto {
  @IsInt({ message: 'expectedVersion deve ser um número inteiro' })
  @Min(1, { message: 'expectedVersion deve ser pelo menos 1' })
  expectedVersion: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'O nome não pode ser vazio' })
  @MaxLength(160, { message: 'O nome não pode exceder 160 caracteres' })
  name?: string;

  @IsOptional()
  @IsBoolean()
  profileConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  photoConfirmed?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContributorParticipationInputDto)
  participations?: ContributorParticipationInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContributorLinkInputDto)
  links?: ContributorLinkInputDto[];
}
