import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
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
  @Matches(/\S/)
  @MaxLength(160, { message: 'O nome não pode exceder 160 caracteres' })
  name?: string;

  @IsOptional()
  @IsBoolean()
  profileConfirmed?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((value: ContributorParticipationInputDto) =>
    typeof value?.semester === 'string'
      ? value.semester.trim()
      : value?.semester,
  )
  @ValidateNested({ each: true })
  @Type(() => ContributorParticipationInputDto)
  participations?: ContributorParticipationInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((value: ContributorLinkInputDto) =>
    typeof value?.url === 'string' ? value.url.trim() : value?.url,
  )
  @ValidateNested({ each: true })
  @Type(() => ContributorLinkInputDto)
  links?: ContributorLinkInputDto[];
}
