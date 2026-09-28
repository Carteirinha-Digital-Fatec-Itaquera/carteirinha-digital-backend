import { EventStatus } from '@prisma/client';
import { IsEnum, IsOptional, Matches } from 'class-validator';

export class EventQueryDto {
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
