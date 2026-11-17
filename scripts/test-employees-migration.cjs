const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Client } = require('pg');

const target = process.env.EMPLOYEE_MIGRATION_TEST_DATABASE_URL;
if (!target) {
  throw new Error(
    'Configure EMPLOYEE_MIGRATION_TEST_DATABASE_URL para banco local disposable_employee_*.',
  );
}

const url = new URL(target);
if (
  url.hostname !== '127.0.0.1' ||
  !url.pathname.startsWith('/disposable_employee_')
) {
  throw new Error(
    'Somente banco local descartável (127.0.0.1 e prefixo disposable_employee_) é permitido.',
  );
}

async function run() {
  const client = new Client({ connectionString: target });
  await client.connect();

  try {
    // Clean public schema in disposable DB
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
    const allMigrations = readdirSync(migrationsDir)
      .filter((name) => name !== 'migration_lock.toml')
      .sort();

    const preEmployeeMigrations = allMigrations.filter(
      (name) => name < '20261117000000_employee_domain',
    );
    const employeeMigration = '20261117000000_employee_domain';
    if (!allMigrations.includes(employeeMigration)) {
      throw new Error(`Migration ${employeeMigration} não encontrada.`);
    }

    // Apply all pre-employee migrations directly
    for (const mig of preEmployeeMigrations) {
      const sql = readFileSync(
        join(migrationsDir, mig, 'migration.sql'),
        'utf8',
      ).replace(/^\uFEFF/, '');
      await client.query(sql);
    }

    // Insert synthetic legacy data
    const studentRa = '1110002223334';
    const studentAccountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const participantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const purgedParticipantId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const attendanceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const certificateId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const ticketId = '12121212-1212-4121-8121-121212121212';

    await client.query(
      `INSERT INTO "Student" (ra, "accountId", course, status, name, admission, email, "dueDate", password)
       VALUES ($1, $2, 'DSM', 'ACTIVE', 'Aluno Legado Sintetico', '2024-1', 'aluno.legado@example.test', '2028-12-31', 'hash-ficticio')`,
      [studentRa, studentAccountId],
    );

    await client.query(
      `INSERT INTO "Secretary" (id, name, email, "dueDate", password, "birthDate")
       VALUES (901, 'Secretaria Sintetica', 'sec.legada@example.test', '2028-12-31', 'hash-ficticio', '1990-01-01')`,
    );

    await client.query(
      `INSERT INTO "Event" (id, title, speaker, location, "startsAt", "endsAt", "workloadMinutes", "createdById", "updatedAt")
       VALUES ($1, 'Evento Legado', 'Palestrante', 'Auditorio', NOW(), NOW() + interval '2 hour', 120, 901, NOW())`,
      [eventId],
    );

    await client.query(
      `INSERT INTO "EventParticipant" (id, "eventId", "accountId", name, course, role)
       VALUES ($1, $2, $3, 'Aluno Legado Sintetico', 'DSM', 'ATTENDEE'),
              ($4, $2, NULL, 'Visitante Purgado', NULL, 'ATTENDEE')`,
      [participantId, eventId, studentAccountId, purgedParticipantId],
    );

    await client.query(
      `INSERT INTO "Attendance" (id, "eventId", "studentRa", "studentName", "studentCourse", "studentAccountId", "participantId", "studentRefRa", status, "updatedAt")
       VALUES ($1, $2, $3, 'Aluno Legado Sintetico', 'DSM', $4, $5, $3, 'CONFIRMED', NOW())`,
      [attendanceId, eventId, studentRa, studentAccountId, participantId],
    );

    await client.query(
      `INSERT INTO "Certificate" (id, "eventId", "studentRa", "studentAccountId", "participantId", "studentRefRa", "attendanceId", "verificationCode", "payloadSnapshot", "activeAttendanceId", "activeParticipantId", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $3, $6, 'CODE-LEGADO-001', '{"studentName":"Aluno Legado Sintetico"}', $6, $5, NOW())`,
      [certificateId, eventId, studentRa, studentAccountId, participantId, attendanceId],
    );

    await client.query(
      `INSERT INTO "SupportTicket" (id, protocol, "requestId", "requestHash", "ownerIdentity", "ownerAccountId", category, subject, "updatedAt")
       VALUES ($1, 'SUP-LEGADO-001', 'req-1', 'hash-1', $2, $3, 'DATA', 'Duvida legada', NOW())`,
      [ticketId, `student:${studentAccountId}`, studentAccountId],
    );

    // Apply employee migration over synthetic legacy data
    const empSql = readFileSync(
      join(migrationsDir, employeeMigration, 'migration.sql'),
      'utf8',
    ).replace(/^\uFEFF/, '');
    await client.query(empSql);

    // Verify legacy rows preserved
    const certRes = await client.query(
      `SELECT id, "verificationCode" FROM "Certificate" WHERE id = $1`,
      [certificateId],
    );
    if (certRes.rowCount !== 1 || certRes.rows[0].verificationCode !== 'CODE-LEGADO-001') {
      throw new Error('Certificado legado não preservado após migration.');
    }

    const purgedRes = await client.query(
      `SELECT id, "employeeAccountId" FROM "EventParticipant" WHERE id = $1`,
      [purgedParticipantId],
    );
    if (purgedRes.rowCount !== 1 || purgedRes.rows[0].employeeAccountId !== null) {
      throw new Error('Participante legado purgado foi alterado indevidamente.');
    }

    // Verify CHECK constraints
    let checkFailed = false;
    try {
      await client.query(
        `INSERT INTO "EventParticipant" (id, "eventId", "accountId", "employeeAccountId", name)
         VALUES (gen_random_uuid()::text, $1, $2, $2, 'Conflito')`,
        [eventId, studentAccountId],
      );
    } catch {
      checkFailed = true;
    }
    if (!checkFailed) {
      throw new Error('CHECK de exclusividade em EventParticipant não bloqueou identidade dupla.');
    }

    console.log('Migration validation passed: empty + synthetic legacy snapshot + CHECK constraints.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
