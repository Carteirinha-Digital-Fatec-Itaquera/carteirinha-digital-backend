import { Transform, Type } from 'class-transformer';
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

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string | null;
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
