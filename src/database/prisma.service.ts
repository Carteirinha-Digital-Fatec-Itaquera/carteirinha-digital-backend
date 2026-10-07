import 'dotenv/config';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

  private static migrationsChecked = false;

  private async ensureMigrationsApplied(): Promise<void> {
    if (!process.env.DIRECT_URL || PrismaService.migrationsChecked) {
      return;
    }
    PrismaService.migrationsChecked = true;

    try {
      this.logger.log('Executando verificação de migrations via Prisma CLI...');
      const output = execSync('npx prisma migrate deploy', {
        env: process.env,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      this.logger.log(`Resultado prisma migrate deploy:\n${output}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Execução de prisma migrate deploy falhou: ${errMsg}`);

      try {
        const columns = (await this.$queryRawUnsafe(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'Student' AND column_name = 'accountId';
        `)) as Array<{ column_name: string }>;

        if (!columns || columns.length === 0) {
          this.logger.warn(
            'Coluna Student.accountId ausente no banco! Aplicando migration SQL de eventos e Student...',
          );
          const candidatePaths = [
            path.resolve(process.cwd(), 'prisma/migrations/20260927224000_issue23_events_schema/migration.sql'),
            path.resolve(__dirname, '../../../prisma/migrations/20260927224000_issue23_events_schema/migration.sql'),
            path.resolve(__dirname, '../../prisma/migrations/20260927224000_issue23_events_schema/migration.sql'),
          ];
          const migrationPath = candidatePaths.find((p) => fs.existsSync(p));
          if (migrationPath) {
            const sql = fs.readFileSync(migrationPath, 'utf-8');
            await this.$executeRawUnsafe(sql);
            this.logger.log('Migration SQL aplicada com sucesso diretamente no PostgreSQL!');
          } else {
            this.logger.error('Arquivo migration.sql não encontrado no filesystem!');
          }
        } else {
          this.logger.log('Coluna Student.accountId já confirmada presente no banco.');
        }
      } catch (sqlErr: unknown) {
        const sqlMsg = sqlErr instanceof Error ? sqlErr.message : String(sqlErr);
        this.logger.error(`Erro ao aplicar fallback de migration SQL: ${sqlMsg}`);
      }
    }
  }
}

//import { PrismaPg } from '@prisma/adapter-pg'
//import { PrismaClient } from '@prisma/client'

//const connectionString = `${process.env.DATABASE_URL}`

//const adapter = new PrismaPg({ connectionString })
//const prisma = new PrismaClient({ adapter })
