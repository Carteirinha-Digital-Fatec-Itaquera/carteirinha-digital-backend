import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAssignmentDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, {
    message: 'startsOn deve estar no formato YYYY-MM-DD',
  })
  startsOn?: string | null;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, {
    message: 'validUntil deve estar no formato YYYY-MM-DD',
  })
  validUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateAssignmentDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, {
    message: 'startsOn deve estar no formato YYYY-MM-DD',
  })
  startsOn?: string | null;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, {
    message: 'validUntil deve estar no formato YYYY-MM-DD',
  })
  validUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
