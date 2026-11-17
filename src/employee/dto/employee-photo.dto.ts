import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UploadEmployeePhotoDto {
  @IsUUID()
  requestId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class ReviewEmployeePhotoDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class RemoveEmployeePhotoDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
