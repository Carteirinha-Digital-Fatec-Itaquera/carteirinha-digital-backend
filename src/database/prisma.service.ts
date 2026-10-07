import 'dotenv/config';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execFileSync } from 'child_process';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
    super({
      adapter,
      log: [
        { level: 'query', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
        { level: 'info', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ],
    });
  }

  async onModuleInit() {
    try {
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Conexão com o banco de dados estabelecida');
      await this.ensureMigrationsApplied();
    } catch (error) {
      this.logger.error('Falha na conexão com o Banco de dados', error);
      throw error;
    }
  }

  private static migrationCheck: Promise<void> | undefined;

  private async ensureMigrationsApplied(): Promise<void> {
    if (!process.env.DIRECT_URL)
      throw new Error(
        'DIRECT_URL deve estar configurada antes de iniciar a API.',
      );
    PrismaService.migrationCheck ??= Promise.resolve().then(() => {
      try {
        const output = execFileSync(
          process.execPath,
          [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
          { env: process.env, stdio: 'pipe', encoding: 'utf-8' },
        );
        this.logger.log(output);
      } catch {
        this.logger.error(
          'Falha nas migrations. A API não será iniciada com schema incompleto.',
        );
        throw new Error('Migrations obrigatórias não foram aplicadas.');
      }
    });
    await PrismaService.migrationCheck;
  }
}
//import { PrismaPg } from '@prisma/adapter-pg'
//import { PrismaClient } from '@prisma/client'

//const connectionString = `${process.env.DATABASE_URL}`

//const adapter = new PrismaPg({ connectionString })
//const prisma = new PrismaClient({ adapter })
