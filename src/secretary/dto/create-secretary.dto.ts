import { IsDate, IsDateString, IsEmail, isNotEmpty, IsNotEmpty, Matches } from 'class-validator';


export class CreateSecretaryDTO {
  id?: number;
  name: string;
  email: string;
  dueDate: string;
  password: string;
  lastLogin?: Date | null
  birthDate: Date ;

  
  // @IsNotEmpty({ message: 'O campo data de nascimento é obrigatório' })
  // @IsDateString({}, { message: "O formato da data de nascimento está inválido" })
}
