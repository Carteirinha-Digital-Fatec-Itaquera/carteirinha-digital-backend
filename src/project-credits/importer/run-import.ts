import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ProjectCreditsModule } from '../project-credits.module';
import { ProjectCreditsImporter } from './project-credits.importer';
import { PrismaService } from '../../database/prisma.service';

async function bootstrap() {
  const isApply = process.argv.includes('--apply');
  const dryRun = !isApply;

  console.log(
    `[Importer] Iniciando importador de créditos (modo: ${dryRun ? 'DRY-RUN' : 'APPLY'})...`,
  );

  const app = await NestFactory.createApplicationContext(ProjectCreditsModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const importer = new ProjectCreditsImporter(prisma);
    const result = await importer.importCuratedCredits(dryRun);
    console.log(
      '[Importer] Resultado da execução:',
      JSON.stringify(result, null, 2),
    );
  } catch (error) {
    console.error('[Importer] Falha na importação:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

void bootstrap().catch(() => {
  console.error('Importação de créditos interrompida.');
  process.exitCode = 1;
});
