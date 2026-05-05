import { BadRequestException } from "@nestjs/common"

export default function ValidarCpf(cpf: string): boolean {
    cpf = cpf.replace(/\D/g, '')

    const sequenciasInvalidas = [
        '00000000000', '11111111111', '22222222222',
        '33333333333', '44444444444', '55555555555',
        '66666666666', '77777777777', '88888888888',
        '99999999999',
    ];

    if (sequenciasInvalidas.includes(cpf)) {
        throw new BadRequestException('CPF inválido');
    }

    if (cpf.length != 11) {
        throw new BadRequestException('CPF inválido, o documento não possui 11 dígitos')
    }

    const digitoVerificador = (cpfIncompleto): string => {
        let somatoria = 0
        for (let i = 0; i < cpfIncompleto.length; i++) {
            const digitoAtual = cpfIncompleto.charAt(i)
            const constante = (cpfIncompleto.length + 1 - i)
            somatoria += Number(digitoAtual) * Number(constante)
        }
        const resto = somatoria % 11
        return resto < 2 ? "0" : (11 - resto).toString()
    }

    let primeiroDigitoVerificador = digitoVerificador(cpf.substring(0, 9))
    let segundoDigitoVerificador = digitoVerificador(cpf.substring(0, 9) + primeiroDigitoVerificador)

    let cpfCorreto = cpf.substring(0, 9) + primeiroDigitoVerificador + segundoDigitoVerificador

    if (cpf != cpfCorreto) {
        throw new BadRequestException('CPF inválido');
    }

    return true
}