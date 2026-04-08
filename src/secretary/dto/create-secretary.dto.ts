import { IsEmpty, IsDate, IsDateString, IsEmail, isEmpty, isNotEmpty, IsNotEmpty, Matches } from 'class-validator';
export class CreateSecretaryDTO {
  id?: number;
  name: string;
  email: string;
  dueDate: string;
  password?: string;
  lastLogin?: Date | null
  // @IsDateString({}, { message: "O formato da data de nascimento está inválido" })
  birthDate: Date ;

  
  // @IsNotEmpty({ message: 'O campo data de nascimento é obrigatório' })
}
