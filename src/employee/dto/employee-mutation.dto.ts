import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class EmployeeReasonMutationDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class UpdateEmployeeStatusDto extends EmployeeReasonMutationDto {
  @IsIn(['ACTIVE', 'BLOCKED'])
  status: 'ACTIVE' | 'BLOCKED';
}

export class RenewEmployeeQrDto extends EmployeeReasonMutationDto {
  @IsUUID()
  requestId: string;
}
