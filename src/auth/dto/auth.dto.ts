import { IsNotEmpty } from 'class-validator';

export class AuthDTO {
  @IsNotEmpty({ message: 'O campo e-mail é obrigatório' })
  email: string;

  @IsNotEmpty({ message: 'O campo senha é obrigatório' })
  password: string;
}
