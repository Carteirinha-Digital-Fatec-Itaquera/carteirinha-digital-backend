import { 
  Injectable, 
  InternalServerErrorException, 
  NotFoundException, 
  BadRequestException 
} from '@nestjs/common';
import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';

import { StudentService } from '../student/student.service';
import { PrismaService } from 'src/database/prisma.service';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { SecretaryRepository } from './repository/secretary.repository';
import { SecretaryEntity } from './entities/secretary.entity';
import { HashContentService } from '../../src/utils/hashContentService';
import { UpdateSecretaryDto } from './dto/update-secretary.dto';
import { MailService } from '../mail/mail.service';

const pdfParse = require('pdf-parse');

@Injectable()
export class SecretaryService {
  constructor(
    private readonly mapper: SecretaryMapper,
    private readonly repository: SecretaryRepository,
    private readonly hashService: HashContentService,
    private readonly prisma: PrismaService,
    private readonly studentService: StudentService,
    private readonly mailService: MailService,
  ) {}

  private normalizeStatus(status: string): string {
    const map: Record<string, string> = {
      'ativo': 'Em curso',
      'em curso': 'Em curso',
      'cursando': 'Em curso',
      'matriculado': 'Em curso',
      'trancado': 'Trancado',
      'concluido': 'Concluído',
      'concluído': 'Concluído',
      'desistente': 'Desistente',
      'evadido': 'Desistente',
      'cancelado': 'Desistente',
    };

    return map[status?.trim().toLowerCase()] ?? status;
  }

  // Novo método auxiliar
  private parseAlunoRow(row: Record<string, any>) {
    const ra = String(row['RA'] ?? row['ra'] ?? '').trim();

    const name = String(
      row['Aluno'] ??
      row['nome'] ??
      row['name'] ??
      '',
    ).trim();

    const course = String(
      row['Curso'] ??
      row['curso'] ??
      row['course'] ??
      '',
    ).trim();

    const period = String(
      row['Turno'] ??
      row['turno'] ??
      row['period'] ??
      '',
    ).trim();

    const status = this.normalizeStatus(
      String(
        row['Situação'] ??
        row['Situacao'] ??
        row['status'] ??
        '',
      ),
    );

    const ciclo = String(
      row['Ciclo'] ??
      row['ciclo'] ??
      row['admission'] ??
      '',
    ).trim();

    const email = String(
      row['E-mail'] ??
      row['email'] ??
      '',
    ).trim();

    return {
      ra,
      name,
      course,
      period,
      status,
      admission: ciclo,
      email,
    };
  }

  async updateDueDate(id: number): Promise<void> {
    const newDueDate = new Date();
    newDueDate.setFullYear(newDueDate.getFullYear() + 1);

    await this.repository.updateDueDate(id, newDueDate);
  }

  async updateSecretaryFromDto(id: number, dto: UpdateSecretaryDto) {
    const existing = await this.repository.findById(id);

    if (!existing) {
      throw new NotFoundException('Secretaria não encontrada');
    }

    const updated = {
      ...existing,
      ...dto,
      id,
      birthDate: dto.birthDate ? new Date(dto.birthDate) : existing.birthDate,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : existing.dueDate,
    };

    await this.repository.update(updated as SecretaryEntity);

    if (dto.password) {
      const hashed = await this.hashService.hashContent(dto.password);
      await this.repository.updatePassword(id, hashed);
    }
  }

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
    if (!secretary.email.endsWith('@cps.sp.gov.br')) {
      throw new BadRequestException(
        'Apenas e-mails com domínio @cps.sp.gov.br são permitidos.',
      );
    }

    const existing = await this.repository.findByEmail(secretary.email);

    if (existing) {
      throw new BadRequestException('E-mail já cadastrado.');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.verificationCode.updateMany({
      where: {
        email: secretary.email,
        used: false,
      },
      data: {
        used: true,
      },
    });

    await this.prisma.verificationCode.create({
      data: {
        email: secretary.email,
        code,
        expiresAt,
      },
    });

    await this.mailService.sendVerificationCode(
      secretary.email,
      code,
    );

    return {
      message: 'Código de verificação enviado para o e-mail.',
    };
  }

  async confirmSecretary(
    email: string,
    code: string,
    secretary: CreateSecretaryDTO,
  ) {
    const verification = await this.prisma.verificationCode.findFirst({
      where: {
        email,
        code,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!verification) {
      throw new BadRequestException(
        'Código inválido ou expirado.',
      );
    }

    await this.prisma.verificationCode.update({
      where: {
        id: verification.id,
      },
      data: {
        used: true,
      },
    });

    try {
      const birthDate = new Date(secretary.birthDate);

      const passwordToHash = secretary.password
        ? secretary.password
        : this.generateInitialPassword(birthDate);

      const hashedPassword =
        await this.hashService.hashContent(passwordToHash);

      const entity = this.mapper.toEntity({
        ...secretary,
        birthDate,
        password: hashedPassword,
        lastLogin: null,
      });

      console.log(`Secretaria criada: ${entity.email}`);

      return await this.repository.create(entity);

    } catch (error) {
      throw new InternalServerErrorException(
        `Erro ao criar secretaria: ${error.message}`,
      );
    }
  }

  async updateSecretary(secretary: SecretaryEntity) {
    const result = await this.repository.findById(secretary.id);

    if (!result) {
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

  async updateSecretaryPassword(
    id: number,
    newPassword: string,
  ) {
    return await this.repository.updatePassword(
      id,
      newPassword,
    );
  }

  private generateInitialPassword(
    birthDate: Date,
  ): string {
    const day = String(
      birthDate.getUTCDate(),
    ).padStart(2, '0');

    const month = String(
      birthDate.getUTCMonth() + 1,
    ).padStart(2, '0');

    const year = String(
      birthDate.getUTCFullYear(),
    );

    return `${day}${month}${year}`;
  }

  // NOVO PROCESSAMENTO XLSX
  async processarAlunosXLSX(buffer: Buffer) {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
    });

    const sheet =
      workbook.Sheets[workbook.SheetNames[0]];

    const records: any[] = XLSX.utils.sheet_to_json(
      sheet,
      { defval: '' },
    );

    if (records.length === 0) {
      throw new BadRequestException(
        'Arquivo vazio ou formato inválido',
      );
    }

    const resultados = {
      total: records.length,
      sucesso: 0,
      erros: [] as {
        linha: number;
        ra: string;
        erro: string;
      }[],
    };

    for (let i = 0; i < records.length; i++) {
      const row = records[i];

      try {
        const aluno = this.parseAlunoRow(row);

        if (
          !aluno.ra ||
          !aluno.name ||
          !aluno.email
        ) {
          throw new Error(
            'Campos obrigatórios faltando: RA, Aluno, E-mail',
          );
        }

        const cpfRaw = row['CPF'] ?? row['cpf'] ?? null;
        const cpf = cpfRaw ? String(cpfRaw).trim() : null;

        const birthDate =
          row['birthDate'] ??
          row['DataNascimento'] ??
          new Date('2000-01-01');

        await this.studentService.createStudent({
          ...aluno,
          cpf,
          birthDate: new Date(birthDate),
          password: '',
        });

        resultados.sucesso++;

      } catch (error) {
        resultados.erros.push({
          linha: i + 2,
          ra: String(records[i]['RA'] ?? 'N/A'),
          erro: error.message,
        });
      }
    }

    return resultados;
  }

  // NOVO PROCESSAMENTO CSV
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
      throw new BadRequestException(
        'Arquivo vazio ou formato inválido',
      );
    }

    const resultados = {
      total: records.length,
      sucesso: 0,
      erros: [] as any[],
    };

    for (let i = 0; i < records.length; i++) {
      try {
        const aluno = this.parseAlunoRow(records[i]);

        if (
          !aluno.ra ||
          !aluno.name ||
          !aluno.email
        ) {
          throw new Error(
            'Campos obrigatórios faltando: RA, Aluno, E-mail',
          );
        }

        const cpfRaw = records[i]['CPF'] ?? records[i]['cpf'] ?? null;
        const cpf = cpfRaw ? String(cpfRaw).trim() : null;

        const birthDate =
          records[i]['birthDate'] ??
          records[i]['DataNascimento'] ??
          '2000-01-01';

        await this.studentService.createStudent({
          ...aluno,
          cpf,
          birthDate: new Date(birthDate),
          password: '',
        });

        resultados.sucesso++;

      } catch (error) {
        resultados.erros.push({
          linha: i + 2,
          ra: records[i]['RA'] ?? 'N/A',
          erro: error.message,
        });
      }
    }

    return resultados;
  }

  // NOVO PROCESSAMENTO TXT
  async processarAlunosTXT(buffer: Buffer) {
    const linhas = buffer
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim());

    if (linhas.length === 0) {
      throw new BadRequestException('Arquivo vazio');
    }

    const headers = linhas[0]
      .split(';')
      .map(h => h.trim());

    const resultados = {
      total: linhas.length - 1,
      sucesso: 0,
      erros: [] as any[],
    };

    for (let i = 1; i < linhas.length; i++) {
      const cols = linhas[i]
        .split(';')
        .map(c => c.trim());

      const row: Record<string, string> = {};

      headers.forEach((h, idx) => {
        row[h] = cols[idx] ?? '';
      });

      try {
        const aluno = this.parseAlunoRow(row);

        if (
          !aluno.ra ||
          !aluno.name ||
          !aluno.email
        ) {
          throw new Error(
            'Campos obrigatórios faltando: RA, Aluno, E-mail',
          );
        }

        const cpfRaw = (row['CPF'] ?? row['cpf'] ?? '') as string;
        const cpf = cpfRaw.trim() !== '' ? cpfRaw.trim() : null;

        const birthDate =
          row['birthDate'] ??
          row['DataNascimento'] ??
          '2000-01-01';

        await this.studentService.createStudent({
          ...aluno,
          cpf,
          birthDate: new Date(birthDate),
          password: '',
        });

        resultados.sucesso++;

      } catch (error) {
        resultados.erros.push({
          linha: i + 1,
          ra: row['RA'] ?? 'N/A',
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

      const linhas = texto
        .split('\n')
        .filter((linha: string) => linha.trim());

      if (linhas.length === 0) {
        throw new BadRequestException(
          'Arquivo vazio ou formato inválido',
        );
      }

      const dadosLinhas = linhas.slice(1);

      const resultados = {
        total: dadosLinhas.length,
        sucesso: 0,
        erros: [] as {
          linha: number;
          ra: string;
          erro: string;
        }[],
      };

      for (let i = 0; i < dadosLinhas.length; i++) {
        const linha = dadosLinhas[i];

        const colunas = linha
          .split(';')
          .map((c: string) => c.trim());

        try {
          if (colunas.length < 8) {
            throw new Error(
              'Formato inválido. Esperado: ra;course;status;name;admission;email;cpf;birthDate',
            );
          }

          const ra = colunas[0];
          const course = colunas[1];
          const status = this.normalizeStatus(
            colunas[2],
          );
          const name = colunas[3];
          const admission = colunas[4];
          const email = colunas[5];
          const cpf = colunas[6];

          const birthDate = new Date(
            colunas[7],
          );

          if (isNaN(birthDate.getTime())) {
            throw new Error(
              `Data de nascimento inválida: ${colunas[7]}`,
            );
          }

          await this.studentService.createStudent({
            ra,
            course,
            status,
            name,
            admission,
            email,
            cpf,
            birthDate,
            password: '',
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

    } catch (error) {
      console.error(
        'Erro ao processar PDF:',
        error,
      );

      throw new BadRequestException(
        'Erro ao processar arquivo PDF: ' +
        error.message,
      );
    }
  }
}