/**
 * Teste de integraÃƒÂ§ÃƒÂ£o para ReconciliaÃƒÂ§ÃƒÂ£o Concorrente (C1) em PostgreSQL descartÃƒÂ¡vel.
 *
 * Requisito estrito de seguranÃƒÂ§a:
 * - NUNCA executa em bancos herdados de produÃƒÂ§ÃƒÂ£o ou desenvolvimento.
 * - Exige variÃƒÂ¡vel CERTIFICATE_TEST_DATABASE_URL ou DISPOSABLE_TEST_DATABASE_URL apontando
 *   para localhost / 127.0.0.1 com banco explicitamente de teste ('/issue27_' ou '/disposable_').
 */

const { URL } = require('node:url');
const assert = require('node:assert/strict');

const targetUrl = process.env.DISPOSABLE_TEST_DATABASE_URL || process.env.CERTIFICATE_TEST_DATABASE_URL;

if (!targetUrl) {
  console.log('[INTEGRATION SKIPPED] Nenhuma variÃƒÂ¡vel DISPOSABLE_TEST_DATABASE_URL ou CERTIFICATE_TEST_DATABASE_URL foi configurada.');
  console.log('Para executar contra PostgreSQL local descartÃƒÂ¡vel, configure:');
  console.log('  export DISPOSABLE_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/disposable_test_reconcile"');
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(targetUrl);
} catch (err) {
  console.error('[ERRO DE SEGURANÃƒâ€¡A] URL invÃƒÂ¡lida:', err.message);
  process.exit(1);
}

const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
const isSafeTestDb = parsed.pathname.startsWith('/disposable_') || parsed.pathname.startsWith('/issue27_');

if (!isLocal || !isSafeTestDb) {
  console.error('[BLOQUEIO DE SEGURANÃƒâ€¡A] O banco fornecido NÃƒÆ’O foi comprovado como descartÃƒÂ¡vel local.');
  console.error(`Host detectado: "${parsed.hostname}" (esperado: localhost ou 127.0.0.1)`);
  console.error(`Database path detectado: "${parsed.pathname}" (esperado prefixo /disposable_ ou /issue27_)`);
  process.exit(1);
}

console.log('[INTEGRATION] PostgreSQL local descartÃ¡vel');
(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { EventOperationsService } = require('../dist/src/public-events/event-operations.service');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: targetUrl }) });
  let event;
  try {
    await prisma.$connect();
    event = await prisma.event.create({ data: {
      title: 'ReconciliaÃ§Ã£o descartÃ¡vel', speaker: 'Teste', location: 'Local',
      startsAt: new Date(), endsAt: new Date(Date.now() + 3600000), workloadMinutes: 60,
    } });
    const attendance = await prisma.attendance.create({ data: {
      eventId: event.id, studentRa: 'TEST-RECONCILE', studentName: 'Participante fictÃ­cio', studentCourse: 'Teste',
    } });
    const certificate = await prisma.certificate.create({ data: {
      eventId: event.id, attendanceId: attendance.id, studentRa: 'TEST-RECONCILE',
      verificationCode: require('node:crypto').randomUUID(), payloadSnapshot: {},
    } });
    const artifact = await prisma.certificateArtifact.create({ data: {
      certificateId: certificate.id, state: 'READY', deliveryState: 'AMBIGUOUS',
    } });
    let entered, release;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    // Hold the first service transaction after its successful mutation, before commit.
    const controlled = { $transaction: callback => prisma.$transaction(async tx => {
      const result = await callback(tx);
      entered();
      await gate;
      return result;
    }, { timeout: 15000 }) };
    const first = new EventOperationsService(controlled, null, null);
    const second = new EventOperationsService(prisma, null, null);
    const dto = { resolution: 'RESCHEDULE_SEND', reason: 'Teste concorrente descartÃ¡vel' };
    const a = first.reconcileDelivery(certificate.id, dto, 1);
    await ready;
    const b = second.reconcileDelivery(certificate.id, dto, 2);
    const settled = Promise.allSettled([a, b]);
    release();
    const results = await settled;
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.getStatus(), 409);
    assert.equal(await prisma.eventAudit.count({ where: { eventId: event.id } }), 1);
    assert.equal((await prisma.certificateArtifact.findUnique({where:{id:artifact.id}})).deliveryState, 'PENDING');
    console.log('[INTEGRATION PASS] ServiÃ§o real: um sucesso, um HTTP 409, uma auditoria.');
  } finally {
    if (event) {
      const certs = await prisma.certificate.findMany({ where: { eventId: event.id }, select: { id: true } });
      await prisma.certificateArtifact.deleteMany({where:{certificateId:{in:certs.map(c=>c.id)}}});
      await prisma.eventAudit.deleteMany({ where: { eventId: event.id } });
      await prisma.certificate.deleteMany({ where: { eventId: event.id } });
      await prisma.attendance.deleteMany({ where: { eventId: event.id } });
      await prisma.event.delete({ where: { id: event.id } });
    }
    await prisma.$disconnect();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
