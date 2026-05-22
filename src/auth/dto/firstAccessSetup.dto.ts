import { IsNotEmpty, IsString, Length } from 'class-validator';

export class FirstAccessSetupDTO {
  @IsNotEmpty()
  @IsString()
  @Length(11, 11, { message: 'O CPF deve ter exatamente 11 dígitos' })
  cpf: string;

  @IsNotEmpty()
  @IsString()
  @Length(8, 8, { message: 'A data de nascimento deve ter exatamente 8 dígitos (DDMMYYYY)' })
  birthDate: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 20, { message: 'A senha deve ter entre 6 e 20 caracteres' })
  newPassword: string;
}