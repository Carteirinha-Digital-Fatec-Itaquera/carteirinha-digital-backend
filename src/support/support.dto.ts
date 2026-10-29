import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  IsBoolean,
  IsDateString,
  Matches,
} from 'class-validator';
export const SUPPORT_CATEGORIES = [
  'DATA',
  'PHOTO_CARD',
  'EVENT',
  'CERTIFICATE',
  'ACCESS',
  'OTHER',
];
export const SUPPORT_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_STUDENT',
  'RESOLVED',
  'CLOSED',
];
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class SupportCreateDto {
  @IsUUID('4') requestId: string;
  @IsIn(SUPPORT_CATEGORIES) category: string;
  @Transform(trim) @IsString() @Length(5, 120) subject: string;
  @Transform(trim) @IsString() @Length(20, 3000) description: string;
  @IsOptional()
  @IsIn(['NAME', 'SOCIAL_NAME', 'COURSE', 'EMAIL', 'OTHER'])
  requestedField?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  proposedValue?: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsUUID() certificateId?: string;
}
export class SupportActionDto {
  @IsUUID('4') requestId: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 3000) message?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(3, 1000) reason?: string;
  @IsOptional() @IsIn(SUPPORT_STATUSES) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) assigneeId?: number;
  @IsOptional() @IsBoolean() confirmed?: boolean;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  resultReference?: string;
}
export class SupportQueryDto {
  @IsOptional() @IsIn(SUPPORT_STATUSES) status?: string;
  @IsOptional() @IsIn(SUPPORT_CATEGORIES) category?: string;
  @IsOptional() @IsIn(['mine', 'unassigned', 'all']) assignee?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class SupportReadDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
