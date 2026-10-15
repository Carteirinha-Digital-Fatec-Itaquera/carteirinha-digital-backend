const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const url = new URL(process.env.DIRECT_URL || '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.startsWith('/public_events_validation_')
)
  throw new Error(
    'Use somente banco local exclusivo public_events_validation_*.',
  );
const client = new Client({ connectionString: url.toString() });
async function main() {
  await client.connect();
  const tables = await client.query(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
  );
  assert.equal(
    tables.rows[0].count,
    0,
    'O teste de upgrade exige um banco vazio; não apaga nem reinicia tabelas.',
  );
  const root = path.join(__dirname, '..', 'prisma', 'migrations');
  const target = '20261015120000_public_events';
  for (const migration of fs
    .readdirSync(root)
    .filter(
      (name) =>
        name !== target &&
        fs.existsSync(path.join(root, name, 'migration.sql')),
    )
    .sort())
    await client.query(
      fs.readFileSync(path.join(root, migration, 'migration.sql'), 'utf8'),
    );
  const event = randomUUID(),
    attendance = randomUUID(),
    cert = randomUUID(),
    account = randomUUID();
  await client.query(
    `INSERT INTO "Student" ("ra","accountId","name","course","status","admission","email","password","dueDate") VALUES ('UPGRADE-TEST',$1,'Aluno histórico','DSM','Ativo','2026','upgrade@example.invalid','unchanged-test-password','2030-01-01')`,
    [account],
  );
  await client.query(
    `INSERT INTO "Event" ("id","title","speaker","location","startsAt","endsAt","workloadMinutes","updatedAt") VALUES ($1,'Evento legado','Palestrante teste','Local teste',NOW(),NOW()+INTERVAL '2 hours',120,NOW())`,
    [event],
  );
  await client.query(
    `INSERT INTO "Attendance" ("id","eventId","studentRa","studentAccountId","studentRefRa","studentName","studentCourse","checkInAt","checkOutAt","status","updatedAt") VALUES ($1,$2,'UPGRADE-TEST',$3,'UPGRADE-TEST','Aluno histórico','DSM',NOW(),NOW(),'CONFIRMED',NOW())`,
    [attendance, event, account],
  );
  const snapshot = {
    studentName: 'Aluno histórico',
    studentRa: 'UPGRADE-TEST',
    course: 'DSM',
    eventTitle: 'Evento legado',
    eventDate: '2026-10-15',
    workload: '2 horas',
    speaker: 'Palestrante teste',
    institution: 'Fatec Itaquera',
  };
  await client.query(
    `INSERT INTO "Certificate" ("id","eventId","studentRa","studentAccountId","studentRefRa","attendanceId","verificationCode","payloadSnapshot","updatedAt") VALUES ($1,$2,'UPGRADE-TEST',$3,'UPGRADE-TEST',$4,'FATEC-EVT-ABCDEFGHJKMNPQRS',$5,NOW())`,
    [cert, event, account, attendance, JSON.stringify(snapshot)],
  );
  await client.query(
    fs.readFileSync(path.join(root, target, 'migration.sql'), 'utf8'),
  );
  const row = (
    await client.query(
      `SELECT a."participantId",c."participantId" AS cert_participant,c."payloadSnapshot",p."accountId" FROM "Attendance" a JOIN "Certificate" c ON c."attendanceId"=a."id" JOIN "EventParticipant" p ON p."id"=a."participantId" WHERE a."id"=$1`,
      [attendance],
    )
  ).rows[0];
  assert.ok(row.participantId);
  assert.equal(row.participantId, row.cert_participant);
  assert.equal(row.accountId, account);
  assert.deepEqual(row.payloadSnapshot, snapshot);
  assert.equal(
    (
      await client.query(
        'SELECT "password" FROM "Student" WHERE "ra"=\'UPGRADE-TEST\'',
      )
    ).rows[0].password,
    'unchanged-test-password',
  );
  await client.query('DELETE FROM "Student" WHERE "ra"=\'UPGRADE-TEST\'');
  const history = (
    await client.query(
      'SELECT "studentRefRa","studentAccountId" FROM "Attendance" WHERE "id"=$1',
      [attendance],
    )
  ).rows[0];
  assert.equal(history.studentRefRa, null);
  assert.equal(history.studentAccountId, account);
  const otherEvent = randomUUID();
  await client.query(
    `INSERT INTO "Event" ("id","title","speaker","location","startsAt","endsAt","workloadMinutes","updatedAt") VALUES ($1,'Outro evento','Palestrante','Local',NOW(),NOW()+INTERVAL '1 hour',60,NOW())`,
    [otherEvent],
  );
  await assert.rejects(
    client.query('UPDATE "EventParticipant" SET "eventId"=$1 WHERE "id"=$2', [
      otherEvent,
      row.participantId,
    ]),
    (error) =>
      ['23503', '23001'].includes(error.code) &&
      error.constraint === 'attendance_participant_event',
  );
  assert.equal(
    (await client.query('SELECT count(*)::int AS count FROM "Certificate"'))
      .rows[0].count,
    1,
  );
  console.log(
    'PASS upgrade: dado legado preservado, backfill de participante/certificado, snapshot v1 intacto, FK histórica e bloqueio entre atividades.',
  );
}
main().finally(() => client.end());
