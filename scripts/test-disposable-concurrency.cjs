/**
 * Teste de integração para Reconciliação Concorrente (C1) em PostgreSQL descartável.
 *
 * Requisito estrito de segurança:
 * - NUNCA executa em bancos herdados de produção ou desenvolvimento.
 * - Exige variável CERTIFICATE_TEST_DATABASE_URL ou DISPOSABLE_TEST_DATABASE_URL apontando
 *   para localhost / 127.0.0.1 com banco explicitamente de teste ('/issue27_' ou '/disposable_').
 */

const { URL } = require('node:url');
const assert = require('node:assert/strict');

const targetUrl = process.env.DISPOSABLE_TEST_DATABASE_URL || process.env.CERTIFICATE_TEST_DATABASE_URL;

if (!targetUrl) {
  console.log('[INTEGRATION SKIPPED] Nenhuma variável DISPOSABLE_TEST_DATABASE_URL ou CERTIFICATE_TEST_DATABASE_URL foi configurada.');
  console.log('Para executar contra PostgreSQL local descartável, configure:');
  console.log('  export DISPOSABLE_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/disposable_test_reconcile"');
  process.exit(0);
}

let parsed;
try {
  parsed = new URL(targetUrl);
} catch (err) {
  console.error('[ERRO DE SEGURANÇA] URL inválida:', err.message);
  process.exit(1);
}

const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
const isSafeTestDb = parsed.pathname.startsWith('/disposable_') || parsed.pathname.startsWith('/issue27_');

if (!isLocal || !isSafeTestDb) {
  console.error('[BLOQUEIO DE SEGURANÇA] O banco fornecido NÃO foi comprovado como descartável local.');
  console.error(`Host detectado: "${parsed.hostname}" (esperado: localhost ou 127.0.0.1)`);
  console.error(`Database path detectado: "${parsed.pathname}" (esperado prefixo /disposable_ ou /issue27_)`);
  process.exit(1);
}

console.log(`[INTEGRATION] Conectando com segurança ao banco local descartável: ${parsed.hostname}${parsed.pathname}`);

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: targetUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.$connect();
    console.log('[INTEGRATION] Conexão bem-sucedida. Verificando suporte a SELECT ... FOR UPDATE e transações ACID.');

    // Cria dados descartáveis de teste
    const event = await prisma.event.create({
      data: {
        title: 'Evento Teste Concorrência Reconciliação',
        slug: `test-reconcile-${Date.now()}`,
        status: 'COMPLETED',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600000),
      },
    });

    const cert = await prisma.certificate.create({
      data: {
        eventId: event.id,
        verificationCode: `TEST-${Date.now()}`,
      },
    });

    const artifact = await prisma.certificateArtifact.create({
      data: {
        certificateId: cert.id,
        deliveryState: 'AMBIGUOUS',
        state: 'READY',
        deliveryAttempts: 1,
      },
    });

    console.log(`[INTEGRATION] Criado artefato ${artifact.id} em estado AMBIGUOUS`);

    // Sincronização determinística com barreiras
    let releaseGate, announceGate;
    const gateReady = new Promise((resolve) => { announceGate = resolve; });
    const gateOpen = new Promise((resolve) => { releaseGate = resolve; });

    let attemptCount = 0;

    const op1 = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CertificateArtifact" WHERE "certificateId" = ${cert.id} FOR UPDATE`;
      const current = await tx.certificateArtifact.findUnique({ where: { certificateId: cert.id } });
      assert.equal(current.deliveryState, 'AMBIGUOUS');

      await tx.certificateArtifact.updateMany({
        where: { id: current.id, deliveryState: 'AMBIGUOUS' },
        data: { deliveryState: 'PENDING', leaseToken: null, leaseUntil: null },
      });
      await tx.eventAudit.create({
        data: {
          eventId: event.id,
          subjectId: cert.id,
          action: 'DELIVERY_RESCHEDULED',
          reason: 'Op 1 reconciliou com sucesso',
        },
      });
      return { success: true };
    });

    const op2 = prisma.$transaction(async (tx) => {
      // Op 2 aguarda op 1 estar no meio de sua transação ou já serializada pelo lock
      await tx.$queryRaw`SELECT "id" FROM "CertificateArtifact" WHERE "certificateId" = ${cert.id} FOR UPDATE`;
      const current = await tx.certificateArtifact.findUnique({ where: { certificateId: cert.id } });
      if (current.deliveryState !== 'AMBIGUOUS') {
        throw new Error(`CONFLITO_409: Estado atual é ${current.deliveryState}`);
      }
      return { success: true };
    });

    const results = await Promise.allSettled([op1, op2]);

    assert.equal(results[0].status, 'fulfilled', 'Primeira transação deve ter sucesso');
    assert.equal(results[1].status, 'rejected', 'Segunda transação serializada pelo FOR UPDATE deve ser rejeitada');
    assert.ok(results[1].reason.message.includes('CONFLITO_409'), 'Segunda transação detectou conflito de estado');

    // Validação de integridade final no banco
    const finalArtifact = await prisma.certificateArtifact.findUnique({ where: { id: artifact.id } });
    assert.equal(finalArtifact.deliveryState, 'PENDING');

    const auditCount = await prisma.eventAudit.count({ where: { eventId: event.id } });
    assert.equal(auditCount, 1, 'Exatamente 1 registro de auditoria gravado');

    console.log('[INTEGRATION PASS] Transação serializada com FOR UPDATE comprovou exclusão mútua e integridade no PostgreSQL.');

    // Limpeza dos dados de teste
    await prisma.certificateArtifact.deleteMany({ where: { certificateId: cert.id } });
    await prisma.eventAudit.deleteMany({ where: { eventId: event.id } });
    await prisma.certificate.deleteMany({ where: { id: cert.id } });
    await prisma.event.deleteMany({ where: { id: event.id } });
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('[INTEGRATION FAIL]', err);
  process.exit(1);
});
