import { IsDate, IsDateString, IsEmail, IsNotEmpty, Matches } from 'class-validator';

export class CreateStudentDTO {
  @IsNotEmpty({ message: 'O campo RA é obrigatório' })
  ra: string;

  @IsNotEmpty({ message: 'O campo curso é obrigatório' })
  course: string;

  @IsNotEmpty({ message: 'O campo periodo é obrigatório' })
  period: string;

  @IsNotEmpty({ message: 'O campo status é obrigatório' })
  status: string;

  @IsNotEmpty({ message: 'O campo nome é obrigatório' })
  name: string;

  @IsNotEmpty({ message: 'O campo ingresso é obrigatório' })
  admission: string;

  @IsNotEmpty({ message: 'O campo e-mail é obrigatório' })
  @IsEmail(undefined, { message: 'O campo e-mail está inválido' })
  email: string;

  @IsNotEmpty({ message: 'O campo CPF é obrigatório' })
  @Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, {
    message: 'CPF deve estar no formato 000.000.000-00',
  })
  cpf: string;

  @IsNotEmpty({ message: 'O campo RG é obrigatório' })
  @Matches(/^\d{2}\.\d{3}\.\d{3}-\d{1}$/, {
    message: 'RG deve estar no formato 00.000.000-0',
  })
  rg: string;

  @IsNotEmpty({ message: 'O campo data de nascimento é obrigatório' })
  @IsDateString({}, { message: "O formato da data de nascimento está inválido" })
  birthDate: string;

  @IsNotEmpty({ message: 'O campo data de vencimento é obrigatório' })
  @IsDateString({}, { message: "O formato da data de vencimento está inválido" })
  dueDate: string;
}
