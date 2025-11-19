export class ViewStudentDTO {
    constructor(
        ra: string,
        curso: string,
        periodo: string,
        status: string,
        name: string,
        ingresso: string,
        email: string,
        cpf: string,
        rg: string,
        qrcode: string,
        foto: string,
        dataNascimento: string,
        dataValidade: string
    ) {
        this.ra = ra
        this.curso = curso
        this.periodo = periodo
        this.status = status
        this.name = name
        this.ingresso = ingresso
        this.email = email
        this.rg = rg
        this.dataNascimento = dataNascimento
        this.dataValidade = dataValidade
    }

    ra: string;
    curso: string;
    periodo: string;
    status: string;
    name: string;
    ingresso: string;
    email: string;
    cpf: string;
    rg: string;
    qrcode: string;
    foto: string;
    dataNascimento: string;
    dataValidade: string;
}