import { IsNotEmpty } from "class-validator";



export class PasswordDTO{
    @IsNotEmpty({message: "É obrigatório inserir uma senha"})
    newPassword:string
}

// export class PasswordResponse