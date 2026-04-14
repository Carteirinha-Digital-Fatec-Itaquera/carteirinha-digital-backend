import { Injectable, InternalServerErrorException, NotFoundException, BadRequestException} from '@nestjs/common';
// import { PrismaService } from 'src/database/prisma.service'; // ajusta se necessário
import { parse } from 'csv-parse';
import { StudentService } from '../student/student.service';
import { PrismaService } from 'src/database/prisma.service';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { SecretaryRepository } from './repository/secretary.repository';
import { SecretaryEntity } from './entities/secretary.entity';
import { HashContentService } from '../../src/utils/hashContentService';


const pdfParse = require('pdf-parse');

@Injectable()
export class SecretaryService {
  constructor(
    private readonly mapper: SecretaryMapper,
    private readonly repository: SecretaryRepository,
    private readonly hashService: HashContentService,
    private readonly prisma: PrismaService,
    private readonly studentService: StudentService,
  ) {}

  async getSecretary(): Promise<SecretaryEntity[]> {
    return await this.repository.findAll();
  }

  async getSecretaryById(id: number): Promise<SecretaryEntity> {
    const result = await this.repository.findById(id);

    if (!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }

    return result;
  }

  async getSecretaryByEmail(email: string): Promise<SecretaryEntity> {
    const result = await this.repository.findByEmail(email);
    if (!result) {
      throw new NotFoundException(
        `Secretaria com email '${email}' não encontrada`,
      );
    }

    return result;
  }

  async createSecretary(secretary: CreateSecretaryDTO) {
    try{

      const birthDate = new Date(secretary.birthDate)
      const rawPassoword = this.generateInitialPassword(secretary.birthDate)
      const hashPassowrd = await this.hashService.hashContent(rawPassoword)
      const entity = this.mapper.toEntity({
        ...secretary,
        birthDate: birthDate,
        password:hashPassowrd,
        lastLogin:null
      })
      // console.log(`${entity.birthDate},\n\nPASSWORD: ${rawPassoword}\N\N\N\Nn${entity.password}, \n${entity.email}`)
      // return await this.repository.create(this.mapper.toEntity(secretary));
      return await this.repository.create(entity)
    }catch (error){
      // return {msg: `\nErro ao criar usuário do tipo Secretaria.\n${error}`}
      console.log(error)
      throw new InternalServerErrorException(`Erro ao criar secretaria: ${error}`)
    }
    
  }

  async updateSecretary(secretary: SecretaryEntity) {
    const result = await this.repository.findById(secretary.id)
    
    if(!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }
    return await this.repository.update(secretary);

  }


  async deleteSecretary(id: number): Promise<void> {
    const result = await this.repository.findById(id);

    if (!result) {
      throw new NotFoundException('Secretaria não encontrada');
    }
    return await this.repository.delete(id);
  }


  async updateLastLogin(id: number) {
    return await this.repository.updateLastLogin(id);
  }



  async updateSecretaryPassword(id:number, newPassword:string){
    return await this.repository.updatePassword(id, newPassword)
  }
  private generateInitialPassword(birthDate: Date): string {
    const date = new Date(birthDate);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = String(date.getUTCFullYear());
    
    return `${day}${month}${year}`;
  }


  async processarAlunosCSV(buffer: Buffer) {
    const records: any[] = [];
    
    const parser = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    for await (const record of parser) {
      records.push(record);
    }

    if (records.length === 0) {
      throw new BadRequestException('Arquivo vazio ou formato inválido');
    }

    const resultados = {
      total: records.length,
      sucesso: 0,
      erros: [] as { linha: number; ra: string; erro: string }[],
    };

    for (let i = 0; i < records.length; i++) {
      const aluno = records[i];
      
      try {
        if (!aluno.ra || !aluno.name || !aluno.email || !aluno.cpf) {
          throw new Error('Campos obrigatórios faltando: ra, name, email, cpf');
        }

        await this.studentService.createStudent({
          ra: aluno.ra,
          course: aluno.course,
          period: aluno.period,
          status: aluno.status,
          name: aluno.name,
          admission: aluno.admission,
          email: aluno.email,
          cpf: aluno.cpf,
          rg: aluno.rg,
          birthDate: aluno.birthDate,
          dueDate: aluno.dueDate,
          password: aluno.password || '123456',
        });
        resultados.sucesso++;
        
      } catch (error) {
        resultados.erros.push({
          linha: i + 2,
          ra: aluno.ra || 'N/A',
          erro: error.message,
        });
      }
    }

    return resultados;
  }

  async processarAlunosTXT(buffer: Buffer) {
    const texto = buffer.toString('utf-8');
    const linhas = texto.split('\n').filter(linha => linha.trim());
    
    if (linhas.length === 0) {
      throw new BadRequestException('Arquivo vazio');
    }

    const dadosLinhas = linhas.slice(1);
    
    const resultados = {
      total: dadosLinhas.length,
      sucesso: 0,
      erros: [] as { linha: number; ra: string; erro: string }[],
    };

    for (let i = 0; i < dadosLinhas.length; i++) {
      const linha = dadosLinhas[i];
      const colunas = linha.split(';').map(c => c.trim());
      
      try {
        if (colunas.length < 11) {
          throw new Error('Formato inválido. Use ponto e vírgula como separador');
        }

        await this.studentService.createStudent({
          ra: colunas[0],
          course: colunas[1],
          period: colunas[2],
          status: colunas[3],
          name: colunas[4],
          admission: colunas[5],
          email: colunas[6],
          cpf: colunas[7],
          rg: colunas[8],
          birthDate: new Date(colunas[9]),
          dueDate: colunas[10],
          password: colunas[11] || '123456',
        });
        resultados.sucesso++;
        
      } catch (error) {
        resultados.erros.push({
          linha: i + 2,
          ra: colunas[0] || 'N/A',
          erro: error.message,
        });
      }
    }

    return resultados;
  }


 async processarAlunosPDF(buffer: Buffer) {
  try {
    const data = await pdfParse(buffer);
    const texto = data.text;
    
    let textoLimpo = texto.replace(/\n/g, '');
    
    const regex = /(2025\d{3});([^;]+);([^;]+);([^;]+);([^;]+);([^;]+);([^;]+);([^;]+);([^;]+);(\d{4}-\d{2}-\d{2});(\d{4}-\d{2}-\d{2});(\d+)/g;
    
    const alunos: any[] = [];
    let match;
    
    while ((match = regex.exec(textoLimpo)) !== null) {
      
      if (match[1] === 'ra' || match[1] === '2025') continue;
      
      alunos.push({
        ra: match[1],
        course: match[2],
        period: match[3],
        status: match[4],
        name: match[5],
        admission: match[6],
        email: match[7],
        cpf: match[8],
        rg: match[9],
        birthDate: match[10],
        dueDate: match[11],
        password: match[12],
      });
    }
    
    const resultados = {
      total: alunos.length,
      sucesso: 0,
      erros: [] as { linha: number; ra: string; erro: string }[],
    };

    for (let i = 0; i < alunos.length; i++) {
      const aluno = alunos[i];
      
      try {
        if (!aluno.ra || !aluno.name || !aluno.email || !aluno.cpf) {
          throw new Error('Campos obrigatórios faltando');
        }

        
        const birthDate = new Date(aluno.birthDate);
        const dueDate = new Date(aluno.dueDate);
        
        if (isNaN(birthDate.getTime())) {
          throw new Error(`Data de nascimento inválida: ${aluno.birthDate}`);
        }
        
        if (isNaN(dueDate.getTime())) {
          throw new Error(`Data de vencimento inválida: ${aluno.dueDate}`);
        }

        await this.studentService.createStudent({
          ra: aluno.ra,
          course: aluno.course,
          period: aluno.period,
          status: aluno.status,
          name: aluno.name,
          admission: aluno.admission,
          email: aluno.email,
          cpf: aluno.cpf,
          rg: aluno.rg,
          birthDate: aluno.birthDate,
          dueDate: aluno.dueDate,
          password: aluno.password || '123456',
        });
        resultados.sucesso++;
        
      } catch (error) {
        resultados.erros.push({
          linha: i + 1,
          ra: aluno.ra || 'N/A',
          erro: error.message,
        });
      }
    }

    return resultados;
  } catch (error) {
    console.error('Erro ao processar PDF:', error);
    throw new BadRequestException('Erro ao processar arquivo PDF: ' + error.message);
  }
}
} 