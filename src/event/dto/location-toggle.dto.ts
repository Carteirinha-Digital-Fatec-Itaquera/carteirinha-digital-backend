import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
export class LocationToggleDto {
  @IsBoolean() enabled: boolean;
  @IsString() @Length(3, 1000) reason: string;
  @IsOptional() geoPolicy?: unknown;
}
