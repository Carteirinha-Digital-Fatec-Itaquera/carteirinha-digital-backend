import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectContributorLinkKind } from '@prisma/client';
import { SEMESTER_REGEX } from '../utils/url-validator';

export class ContributorParticipationInputDto {
  @IsString()
  @Matches(SEMESTER_REGEX, {
    message: 'O semestre deve estar no formato YYYY.1 ou YYYY.2 (ex: 2026.2)',
  })
  semester: string;

  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'O curso não pode exceder 120 caracteres' })
  course?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @IsNotEmpty({ each: true })
  roles: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'A contribuição não pode exceder 500 caracteres' })
  contribution?: string;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class ContributorLinkInputDto {
  @IsEnum(ProjectContributorLinkKind, {
    message: 'Tipo de link inválido (GITHUB, LINKEDIN, EMAIL, EXTERNAL)',
  })
  kind: ProjectContributorLinkKind;

  @IsString()
  @IsNotEmpty({ message: 'O rótulo do link é obrigatório' })
  @MaxLength(60, { message: 'O rótulo não pode exceder 60 caracteres' })
  label: string;

  @IsString()
  @IsNotEmpty({ message: 'A URL do link é obrigatória' })
  @MaxLength(2048, { message: 'A URL não pode exceder 2.048 caracteres' })
  url: string;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateContributorDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome do colaborador é obrigatório' })
  @Matches(/\S/, { message: 'O nome não pode conter somente espaços' })
  @MaxLength(160, { message: 'O nome não pode exceder 160 caracteres' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  slug?: string;

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
