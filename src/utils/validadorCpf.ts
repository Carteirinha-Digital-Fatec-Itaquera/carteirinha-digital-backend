import { BadRequestException } from "@nestjs/common"
import { error } from "console"

export default function ValidarCpf(cpf: string): boolean{
    cpf = cpf.replace(/\D/g, '')

    if(cpf.length != 11){
        throw new error('CPF inválido, o documento não possui 11 dígitos', error)
    }

    const digitoVerificador = (cpfIncompleto): string => {
        let somatoria = 0
        for(let i = 0; i < cpfIncompleto.length; i++){
        const digitoAtual = cpfIncompleto.charAt(i)

        const constante = (cpfIncompleto.length + 1 - i)

        somatoria += Number(digitoAtual) * Number(constante)

    }
    const resto = somatoria % 11

    return resto < 2 ? "0" : (11 - resto).toString()

    }

   let primeiroDigitoVerificador = digitoVerificador(cpf.substring(0,9))
   let segundoDigitoVerificador = digitoVerificador(cpf.substring(0,9) + primeiroDigitoVerificador)

   let cpfCorreto = cpf.substring(0,9) + primeiroDigitoVerificador + segundoDigitoVerificador

   if(cpf != cpfCorreto){
    throw new BadRequestException('CPF inválido');

   }

   return true  
    
}