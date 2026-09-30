import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateVerificationCode } from '../src/certificate/verification-code';
import { buildCertificateSnapshot } from '../src/certificate/certificate.snapshot';

interface BackfillSummary {
  eligible: number;
  emitted: number;
  existing: number;
  skipped: number;
  errors: number;
}

async function run() {
  const targetUrl = process.env.CERTIFICATE_BACKFILL_DATABASE_URL;
  if (!targetUrl) {
    console.error(
      'ERRO: Configure CERTIFICATE_BACKFILL_DATABASE_URL explicitamente.',
    );
    process.exit(1);
  }

  const parsedUrl = new URL(targetUrl);
  if (!['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
    console.error(
      'ERRO: Por segurança, o backfill desta issue aceita somente conexão local (localhost/127.0.0.1).',
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply || args.includes('--dry-run');

  let eventIdFilter: string | undefined;
  const eventIdIdx = args.indexOf('--event-id');
  if (eventIdIdx !== -1 && args[eventIdIdx + 1]) {
    eventIdFilter = args[eventIdIdx + 1];
  }

  console.log(
    `Iniciando Backfill de Certificados [Modo: ${isDryRun ? 'DRY-RUN (Sem escrita)' : 'APPLY (Escrita ativa)'}]`,
  );
  if (eventIdFilter) {
    console.log(`Filtrando pelo Evento: ${eventIdFilter}`);
  }

  const adapter = new PrismaPg({ connectionString: targetUrl });
  const prisma = new PrismaClient({ adapter });

  const summary: BackfillSummary = {
    eligible: 0,
    emitted: 0,
    existing: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    let cursor: string | undefined;
    const batchSize = 100;

    while (true) {
      const attendances = await prisma.attendance.findMany({
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        where: {
          status: 'CONFIRMED',
          checkInAt: { not: null },
          checkOutAt: { not: null },
          event: {
            certificateEnabled: true,
            status: { not: 'CANCELLED' },
            ...(eventIdFilter ? { id: eventIdFilter } : {}),
          },
        },
        include: {
          event: true,
          certificate: true,
        },
        orderBy: { id: 'asc' },
      });

      if (attendances.length === 0) {
        break;
      }

      for (const att of attendances) {
        cursor = att.id;

        if (att.certificate) {
          summary.existing++;
          continue;
        }

        summary.eligible++;

        if (isDryRun) {
          // No modo dry-run não grava nada
          continue;
        }

        try {
          await prisma.$transaction(async (tx) => {
            // Verificar unicidade antes de emitir
            const existing = await tx.certificate.findFirst({
              where: {
                OR: [
                  { attendanceId: att.id },
                  { eventId: att.eventId, studentRa: att.studentRa },
                ],
              },
            });

            if (existing) {
              summary.existing++;
              return;
            }

            // Identificar vínculo atual de aluno
            const currentStudent = await tx.student.findUnique({
              where: { ra: att.studentRa },
            });
            const studentRefRa =
              currentStudent &&
              currentStudent.accountId === att.studentAccountId
                ? currentStudent.ra
                : null;

            const snapshot = buildCertificateSnapshot(att, att.event);
            const verificationCode = generateVerificationCode();

            await tx.certificate.create({
              data: {
                eventId: att.eventId,
                studentRa: att.studentRa,
                studentAccountId: att.studentAccountId,
                studentRefRa,
                attendanceId: att.id,
                verificationCode,
                payloadSnapshot: snapshot as any,
              },
            });

            summary.emitted++;
          });
        } catch (err) {
          console.error(`Erro ao processar attendance ${att.id}:`, err);
          summary.errors++;
        }
      }
    }

    console.log('\n--- Relatório Final de Backfill ---');
    console.log(`Presenças elegíveis: ${summary.eligible}`);
    console.log(`Certificados já existentes: ${summary.existing}`);
    console.log(`Certificados emitidos: ${summary.emitted}`);
    console.log(`Presenças ignoradas: ${summary.skipped}`);
    console.log(`Erros: ${summary.errors}`);

    if (summary.errors > 0) {
      process.exit(2);
    }
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error('Falha fatal no backfill:', err);
  process.exit(1);
});
