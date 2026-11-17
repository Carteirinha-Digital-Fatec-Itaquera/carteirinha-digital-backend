import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateEmployeeDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  socialName?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email?: string;

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

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, { message: 'admissionDate deve estar no formato YYYY-MM-DD' })
  admissionDate?: string;
}
