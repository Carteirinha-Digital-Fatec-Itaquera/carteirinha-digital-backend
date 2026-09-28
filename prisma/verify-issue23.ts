import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { StudentCleanupService } from '../src/student/student-cleanup.service';

// This script intentionally exercises writes and deletes. It must never run
// against a shared, remote, or production database.
const connection = process.env.DIRECT_URL;
if (!connection || process.env.ISSUE23_LOCAL_TEST !== '1') {
  throw new Error('ISSUE23_LOCAL_TEST=1 and DIRECT_URL are required');
}
const url = new URL(connection);
if (
  url.hostname !== '127.0.0.1' ||
  url.port !== '55432' ||
  !['/issue23_migration', '/issue23_fresh'].includes(url.pathname)
) {
  throw new Error(
    'Issue #23 verification only accepts the disposable local databases',
  );
}

const prisma = new PrismaService();
const suffix = randomUUID().slice(0, 8);
const manualRa = `ISS23-MAN-${suffix}`;
const cleanupRa = `ISS23-CRON-${suffix}`;
const checkInAt = new Date('2026-10-05T19:01:00.000Z');

async function mustReject(label: string, operation: () => Promise<unknown>) {
  await assert.rejects(operation, label);
}

async function main() {
  await prisma.onModuleInit();

  if (url.pathname === '/issue23_migration') {
    const legacy = await prisma.student.findUniqueOrThrow({
      where: { ra: '0001234567890' },
    });
    assert.match(legacy.accountId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  }

  const secretary = await prisma.secretary.create({
    data: {
      name: 'Secretaria Ficticia Issue 23',
      email: `secretary-${suffix}@example.invalid`,
      password: 'hash-ficticio',
      birthDate: new Date('1985-01-01T00:00:00.000Z'),
      dueDate: new Date('2032-01-01T00:00:00.000Z'),
    },
  });

  // The existing Student repository omits accountId; the database must fill it.
  const manualStudent = await prisma.student.create({
    data: {
      ra: manualRa,
      course: 'Curso Ficticio',
      status: 'Ativo',
      name: 'Aluno Manual Ficticio',
      admission: '2026-01',
      email: `manual-${suffix}@example.invalid`,
      birthDate: new Date('2002-01-01T00:00:00.000Z'),
      dueDate: new Date('2032-01-01T00:00:00.000Z'),
      password: 'hash-ficticio',
    },
  });
  assert.match(manualStudent.accountId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);

  // A SQL caller that omits accountId receives the same database default.
  await prisma.$executeRaw`
    INSERT INTO "Student" ("ra", "course", "status", "name", "admission", "email", "birthDate", "dueDate", "password")
    VALUES (${cleanupRa}, 'Curso Ficticio', 'Concluído', 'Aluno Cron Ficticio', '2020-01',
            ${`cron-${suffix}@example.invalid`}, ${new Date('2001-01-01T00:00:00.000Z')},
            ${new Date('2020-01-01T00:00:00.000Z')}, 'hash-ficticio')
  `;
  const cleanupStudent = await prisma.student.findUniqueOrThrow({
    where: { ra: cleanupRa },
  });
  assert.match(cleanupStudent.accountId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.notEqual(manualStudent.accountId, cleanupStudent.accountId);

  const event = await prisma.event.create({
    data: {
      title: 'Evento Ficticio Issue 23',
      speaker: 'Palestrante Ficticio',
      location: 'Auditorio Ficticio',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      workloadMinutes: 120,
      createdById: secretary.id,
      checkpoints: {
        create: [{ type: 'CHECK_IN' }, { type: 'CHECK_OUT' }],
      },
    },
    include: { checkpoints: true },
  });
  assert.equal(event.checkpoints.length, 2);
  assert.deepEqual(event.checkpoints.map((item) => item.type).sort(), [
    'CHECK_IN',
    'CHECK_OUT',
  ]);
  await mustReject('checkpoint must be unique per event/type', () =>
    prisma.eventCheckpoint.create({
      data: { eventId: event.id, type: 'CHECK_IN' },
    }),
  );

  const manualAttendance = await prisma.attendance.create({
    data: {
      eventId: event.id,
      studentRa: manualRa,
      studentName: manualStudent.name,
      studentCourse: manualStudent.course,
      studentAccountId: manualStudent.accountId,
      studentRefRa: manualRa,
      checkInAt,
    },
  });
  const cleanupAttendance = await prisma.attendance.create({
    data: {
      eventId: event.id,
      studentRa: cleanupRa,
      studentName: cleanupStudent.name,
      studentCourse: cleanupStudent.course,
      studentAccountId: cleanupStudent.accountId,
      studentRefRa: cleanupRa,
      checkInAt,
    },
  });
  await mustReject('attendance must be unique per event/RA', () =>
    prisma.attendance.create({
      data: {
        eventId: event.id,
        studentRa: manualRa,
        studentName: manualStudent.name,
        studentCourse: manualStudent.course,
        studentAccountId: manualStudent.accountId,
      },
    }),
  );
  await mustReject('optional student reference must match historical RA', () =>
    prisma.attendance.create({
      data: {
        eventId: event.id,
        studentRa: `ISS23-OTHER-${suffix}`,
        studentName: 'Outro Aluno Ficticio',
        studentCourse: 'Curso Ficticio',
        studentAccountId: manualStudent.accountId,
        studentRefRa: manualRa,
      },
    }),
  );
  await mustReject('Student.accountId must be immutable', () =>
    prisma.student.update({
      where: { ra: manualRa },
      data: { accountId: randomUUID() },
    }),
  );
  await mustReject('Attendance snapshots must be immutable', () =>
    prisma.attendance.update({
      where: { id: manualAttendance.id },
      data: { studentName: 'Nome Alterado' },
    }),
  );

  for (const attendance of [manualAttendance, cleanupAttendance]) {
    await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        status: 'CONFIRMED',
        checkOutAt: new Date('2026-10-05T21:01:00.000Z'),
      },
    });
  }

  const makeCertificate = (attendance: typeof manualAttendance, code: string) =>
    prisma.certificate.create({
      data: {
        eventId: event.id,
        studentRa: attendance.studentRa,
        studentAccountId: attendance.studentAccountId,
        studentRefRa: attendance.studentRefRa,
        attendanceId: attendance.id,
        verificationCode: code,
        payloadSnapshot: {
          studentName: attendance.studentName,
          studentRa: attendance.studentRa,
          studentCourse: attendance.studentCourse,
          eventTitle: event.title,
        },
      },
    });
  const manualCertificate = await makeCertificate(
    manualAttendance,
    `FATEC-EVT-ISS23-MAN-${suffix}`,
  );
  const cleanupCertificate = await makeCertificate(
    cleanupAttendance,
    `FATEC-EVT-ISS23-CRON-${suffix}`,
  );
  await mustReject('Certificate snapshots must be immutable', () =>
    prisma.certificate.update({
      where: { id: manualCertificate.id },
      data: { payloadSnapshot: { studentName: 'Nome Alterado' } },
    }),
  );
  const otherAttendance = await prisma.attendance.create({
    data: {
      eventId: event.id,
      studentRa: `ISS23-OTHER-${suffix}`,
      studentName: 'Outro Aluno Ficticio',
      studentCourse: 'Curso Ficticio',
      studentAccountId: randomUUID(),
      checkInAt,
      checkOutAt: new Date('2026-10-05T21:01:00.000Z'),
      status: 'CONFIRMED',
    },
  });
  await mustReject('Certificate verification code must be unique', () =>
    makeCertificate(otherAttendance, manualCertificate.verificationCode),
  );
  await mustReject('Certificate attendance must be unique', () =>
    prisma.certificate.create({
      data: {
        eventId: event.id,
        studentRa: otherAttendance.studentRa,
        studentAccountId: otherAttendance.studentAccountId,
        attendanceId: manualAttendance.id,
        verificationCode: `FATEC-EVT-ISS23-OTHER-${suffix}`,
        payloadSnapshot: {},
      },
    }),
  );
  await prisma.certificate.update({
    where: { id: manualCertificate.id },
    data: { revokedAt: new Date('2026-10-06T00:00:00.000Z') },
  });

  await prisma.student.delete({ where: { ra: manualRa } });
  const cleanup = new StudentCleanupService(prisma);
  await cleanup.cleanupConcludedStudents();
  assert.equal(
    await prisma.student.findUnique({ where: { ra: cleanupRa } }),
    null,
  );
  assert.equal(await prisma.studentLog.count({ where: { ra: cleanupRa } }), 1);

  for (const [attendance, certificate] of [
    [manualAttendance, manualCertificate],
    [cleanupAttendance, cleanupCertificate],
  ] as const) {
    const retainedAttendance = await prisma.attendance.findUniqueOrThrow({
      where: { id: attendance.id },
    });
    const retainedCertificate = await prisma.certificate.findUniqueOrThrow({
      where: { id: certificate.id },
    });
    assert.equal(retainedAttendance.studentRefRa, null);
    assert.equal(retainedCertificate.studentRefRa, null);
    assert.equal(
      retainedAttendance.studentAccountId,
      attendance.studentAccountId,
    );
    assert.equal(
      retainedCertificate.studentAccountId,
      attendance.studentAccountId,
    );
    assert.equal(
      retainedCertificate.verificationCode,
      certificate.verificationCode,
    );
  }

  const reused = await prisma.student.create({
    data: {
      ra: manualRa,
      course: 'Outro Curso Ficticio',
      status: 'Ativo',
      name: 'Nova Conta Ficticia',
      admission: '2026-02',
      email: `reused-${suffix}@example.invalid`,
      dueDate: new Date('2032-01-01T00:00:00.000Z'),
      password: 'hash-ficticio',
    },
  });
  assert.notEqual(reused.accountId, manualStudent.accountId);
  assert.equal(
    await prisma.attendance.count({
      where: { studentRefRa: manualRa, studentAccountId: reused.accountId },
    }),
    0,
  );
  await prisma.secretary.delete({ where: { id: secretary.id } });
  assert.equal(
    (await prisma.event.findUniqueOrThrow({ where: { id: event.id } }))
      .createdById,
    null,
  );
  await mustReject('Event history must restrict deletion', () =>
    prisma.event.delete({ where: { id: event.id } }),
  );

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `;
  const indexNames = new Set(indexes.map((item) => item.indexname));
  for (const name of [
    'Student_accountId_key',
    'Event_createdById_idx',
    'EventCheckpoint_eventId_type_key',
    'Attendance_eventId_studentRa_key',
    'Attendance_studentRefRa_studentAccountId_idx',
    'Certificate_eventId_studentRa_key',
    'Certificate_attendanceId_key',
    'Certificate_verificationCode_key',
    'Certificate_studentRefRa_studentAccountId_idx',
  ]) {
    assert.ok(indexNames.has(name), `missing index ${name}`);
  }

  console.log(`Issue #23 PostgreSQL verification passed: ${url.pathname}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
