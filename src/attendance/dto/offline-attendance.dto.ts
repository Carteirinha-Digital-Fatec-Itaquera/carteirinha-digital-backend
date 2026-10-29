import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsUUID,
  Matches,
} from 'class-validator';

export class OfflineSubmitDto {
  @IsUUID() requestId!: string;
  @IsUUID() accountId!: string;
  @Matches(/^[A-Za-z0-9_-]{10,64}$/) reference!: string;
  @IsISO8601({ strict: true }) scannedAt!: string;
}
export class OfflineStatusDto {
  @IsUUID() accountId!: string;
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  requestIds!: string[];
}
