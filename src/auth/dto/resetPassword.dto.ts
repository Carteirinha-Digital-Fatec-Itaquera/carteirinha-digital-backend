import { IsNotEmpty, IsOptional } from "class-validator";



export class PasswordDTO{
    @IsNotEmpty({message: "É obrigatório inserir uma senha"})
    newPassword:string
    
    @IsOptional({message: "Tokem invalido ou inativo"})
    token?: string;

    @IsOptional({message:"Email inserido invalido"})
    email?:String
}

// export class PasswordResponse