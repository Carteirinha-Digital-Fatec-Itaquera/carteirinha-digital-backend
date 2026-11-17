import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { EmployeeAccountStatus } from '@prisma/client';

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
};

export class EmployeeQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(EmployeeAccountStatus)
  accountStatus?: EmployeeAccountStatus;

  @IsOptional()
  @IsString()
  credentialStatus?: 'VALID' | 'INVALID';

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  hasRegistration?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
