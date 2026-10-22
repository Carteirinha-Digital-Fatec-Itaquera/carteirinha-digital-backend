import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ArrayMinSize,
  ArrayMaxSize,
  IsNumber,
  Matches,
  ValidateNested,
  IsJWT,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
export class SeriesDto {
  @IsString() @Length(3, 120) title: string;
  @IsString() @Length(3, 80) slug: string;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsBoolean() published: boolean;
  @IsOptional() @IsBoolean() cpfRequired?: boolean;
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  courses: string[];
}
export class RegisterVisitorDto {
  @IsUUID() seriesId: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 160)
  name: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @IsString() @MaxLength(120) course?: string;
  @IsString() @Matches(/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/) cpf: string;
}
export class VerifyVisitorDto {
  @IsUUID() registrationId: string;
  @IsString() @Length(6, 6) code: string;
}
export class VisitorCpfDto {
  @IsString() @Matches(/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/) cpf: string;
}
export class TemplateDto {
  @IsString() @Length(3, 120) name: string;
  @IsIn(['ATTENDEE', 'SPEAKER']) role: string;
  @IsString() @Length(3, 160) heading: string;
  @IsString() @Length(3, 200) edition: string;
  @IsOptional() @IsUUID() backgroundAssetId?: string;
  @IsOptional() @IsBoolean() autoPublish?: boolean;
}
export class SignerDto {
  @IsString() @Length(3, 160) name: string;
  @IsString() @Length(3, 160) title: string;
  @IsOptional() @IsString() @MaxLength(120) course?: string;
  @IsUUID() assetId: string;
  @IsBoolean() authorized: boolean;
}
export class EventConfigurationDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  speakerSignerIds?: string[];
  @IsOptional() @IsUUID() seriesId?: string;
  @IsBoolean() visitorsAllowed: boolean;
  @IsOptional() @IsString() @Length(3, 120) organizerCourse?: string;
  @IsOptional() @IsString() @MaxLength(160) promoter?: string;
  @IsOptional() @IsInt() @Min(15) @Max(15) windowMinutes?: number;
  @IsOptional() geoPolicy?: unknown;
  @IsOptional() @IsUUID() attendeeTemplateId?: string;
  @IsOptional() @IsUUID() speakerTemplateId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  signerIds?: string[];
}
export class ManualPresenceDto {
  @IsUUID() participantId: string;
  @IsIn(['CHECK_IN', 'CHECK_OUT']) checkpoint: 'CHECK_IN' | 'CHECK_OUT';
  @IsString() @Length(10, 1000) reason: string;
}
export class PositionDto {
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsNumber() @Min(0) accuracy: number;
  @IsNumber() @Min(0) timestamp: number;
  @IsUUID() challengeId: string;
}
export class VisitorScanDto {
  @IsOptional() @IsUUID() eventId?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{10,64}$/) reference: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => PositionDto)
  position?: PositionDto;
}
export class StudentChallengeDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{10,64}$/)
  reference?: string;
  @IsOptional() @IsJWT() @MaxLength(8192) qrToken?: string;
}
export class SignerSelectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  signerIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  eventTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  speaker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  promoter?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  workload?: string;
}
export class RoleMutationDto {
  @IsIn(['ATTENDEE', 'SPEAKER']) role: string;
  @IsString() @Length(10, 1000) reason: string;
}
export class ParticipantCorrectionDto {
  @IsString() @Length(3, 160) name: string;
  @IsOptional() @IsString() @MaxLength(120) course?: string;
  @IsString() @Length(10, 1000) reason: string;
}

export class CreateEventFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  suggestions?: string;
}
