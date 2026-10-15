import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  speaker: string;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsISO8601()
  startsAt: string;

  @IsISO8601()
  endsAt: string;

  @IsInt()
  @Min(1)
  workloadMinutes: number;

  @IsOptional()
  @IsBoolean()
  certificateEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  visitorsAllowed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizerCourse?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  promoter?: string;

  @IsOptional()
  geoPolicy?: unknown;

  @IsOptional()
  @IsUUID()
  attendeeTemplateId?: string;

  @IsOptional()
  @IsUUID()
  speakerTemplateId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  signerIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  speakerSignerIds?: string[];

  @IsOptional()
  certificatePolicies?: unknown;

  @IsOptional()
  @IsUUID()
  seriesId?: string;
}
