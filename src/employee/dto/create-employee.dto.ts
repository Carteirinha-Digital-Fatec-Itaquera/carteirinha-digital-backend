import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEmployeeAssignmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, { message: 'startsOn deve estar no formato YYYY-MM-DD' })
  startsOn?: string | null;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, { message: 'validUntil deve estar no formato YYYY-MM-DD' })
  validUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateEmployeeDto {
  @IsUUID()
  requestId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  socialName?: string | null;

  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  registrationNumber?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  rg?: string | null;

  @IsString()
  @Matches(ISO_DATE_REGEX, { message: 'admissionDate deve estar no formato YYYY-MM-DD' })
  admissionDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateEmployeeAssignmentDto)
  assignments: CreateEmployeeAssignmentDto[];
}
