import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsInt, Min } from 'class-validator';

export class PhotoVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class UploadContributorPhotoDto extends PhotoVersionDto {
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  @Equals(true, { message: 'Confirme a autorização para publicar a foto.' })
  photoConfirmed: boolean;
}
