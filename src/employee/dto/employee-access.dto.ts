import {
  IsEmail,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class EmployeeLoginDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class EmployeeEmailRequestDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;
}

export class EmployeeTokenPasswordDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token: string;

  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  @MaxLength(128)
  newPassword: string;
}

export class EmployeeChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'A nova senha deve ter no mínimo 8 caracteres' })
  @MaxLength(128)
  newPassword: string;
}

export class EmployeeInviteDto {
  @IsUUID()
  requestId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;
}
