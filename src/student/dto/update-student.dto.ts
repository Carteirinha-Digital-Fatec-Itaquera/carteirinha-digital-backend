import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(160) socialName?: string;
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  course?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  admission?: string;

  @IsOptional()
  @IsString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;
}
