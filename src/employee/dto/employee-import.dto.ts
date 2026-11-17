import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EmployeeImportMode } from '@prisma/client';

export class AnalyzeEmployeeImportDto {
  @IsOptional()
  @IsEnum(EmployeeImportMode)
  mode?: EmployeeImportMode;
}

export class ConfirmEmployeeImportDto {
  @IsUUID()
  requestId: string;

  @IsInt()
  @Min(1)
  revision: number;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  reviewDigest: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  selectedGroupIds: string[];
}

export class CancelEmployeeImportDto {
  @IsUUID()
  requestId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class ReprocessEmployeeImportDto {
  @IsUUID()
  requestId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  groupIds: string[];
}
