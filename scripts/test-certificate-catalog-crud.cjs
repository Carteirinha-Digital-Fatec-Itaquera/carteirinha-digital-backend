// Run only against an explicitly configured disposable local PostgreSQL database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  EventCatalogService,
} = require('../dist/src/public-events/event-catalog.service');
const url = new URL(process.env.CATALOG_TEST_DATABASE_URL || '');
assert.ok(
  ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.pathname.startsWith('/disposable_'),
  'Use a disposable local test database',
);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
(async () => {
  const ids = { assets: [] };
  try {
    for (let i = 0; i < 2; i++)
      ids.assets.push(
        (
          await prisma.eventAsset.create({
            data: {
              kind: 'SIGNATURE',
              storageKey: `test/${randomUUID()}`,
              sha256: 'test',
            },
          })
        ).id,
      );
    const service = new EventCatalogService(prisma, {});
    const model = await service.template(
      {
        name: `CRUD ${randomUUID()}`,
        role: 'ATTENDEE',
        heading: 'CERTIFICADO',
        edition: 'Semana de teste',
        design: 'TECHNOLOGY_BLUE_2026_DARK',
        autoPublish: true,
      },
      1,
    );
    ids.template = model.id;
    const signer = await service.signer(
      {
        name: `Pessoa ${randomUUID()}`,
        title: 'Coordenador',
        authorized: true,
        assetId: ids.assets[0],
      },
      1,
    );
    ids.signer = signer.id;
    const event = await prisma.event.create({
      data: {
        title: 'Evento teste CRUD',
        speaker: 'Fictício',
        location: 'Local',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600000),
        workloadMinutes: 60,
      },
    });
    ids.event = event.id;
    const attendance = await prisma.attendance.create({
      data: {
        eventId: event.id,
        studentRa: 'TEST',
        studentName: 'Pessoa teste',
        studentCourse: 'Teste',
      },
    });
    const snapshot = {
      template: { id: model.id, version: model.version, ...model.config },
      signers: [{ id: signer.id, name: signer.name, assetId: signer.assetId }],
    };
    const cert = await prisma.certificate.create({
      data: {
        eventId: event.id,
        attendanceId: attendance.id,
        studentRa: 'TEST',
        verificationCode: randomUUID(),
        payloadSnapshot: snapshot,
      },
    });
    const dto = {
      name: model.name,
      role: 'ATTENDEE',
      heading: 'TÍTULO CORRIGIDO',
      edition: 'Semana corrigida',
      expectedVersion: model.version,
    };
    const results = await Promise.allSettled([
      service.updateTemplate(model.id, dto, 1),
      service.updateTemplate(model.id, { ...dto, heading: 'OUTRA EDIÇÃO' }, 2),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected');
    assert.equal(rejected.reason.getStatus(), 409);
    const updated = await prisma.certificateTemplate.findUniqueOrThrow({
      where: { id: model.id },
    });
    assert.equal(updated.version, model.version + 1);
    const updatedSigner = await service.updateSigner(
      signer.id,
      {
        name: signer.name,
        title: 'Diretor',
        assetId: ids.assets[1],
        authorized: true,
        expectedVersion: signer.version,
      },
      1,
    );
    await service.deleteCatalogItem('templates', model.id, updated.version, 1);
    await service.deleteCatalogItem(
      'signers',
      signer.id,
      updatedSigner.version,
      1,
    );
    assert.equal(
      (
        await prisma.certificateTemplate.findUniqueOrThrow({
          where: { id: model.id },
        })
      ).status,
      'ARCHIVED',
    );
    assert.equal(
      (
        await prisma.certificateSigner.findUniqueOrThrow({
          where: { id: signer.id },
        })
      ).archived,
      true,
    );
    assert.deepEqual(
      (await prisma.certificate.findUniqueOrThrow({ where: { id: cert.id } }))
        .payloadSnapshot,
      snapshot,
    );
    assert.ok(
      await prisma.eventAsset.findUnique({ where: { id: ids.assets[0] } }),
    );
    assert.equal(
      await prisma.eventAudit.count({
        where: { subjectId: model.id, action: 'TEMPLATE_UPDATED' },
      }),
      1,
    );
    console.log(
      'PASS: CRUD real, conflito 409, exclusão lógica, auditoria e snapshot original preservados.',
    );
  } finally {
    if (ids.event) {
      await prisma.certificate.deleteMany({ where: { eventId: ids.event } });
      await prisma.attendance.deleteMany({ where: { eventId: ids.event } });
      await prisma.event.delete({ where: { id: ids.event } });
    }
    await prisma.eventAudit.deleteMany({
      where: { subjectId: { in: [ids.template, ids.signer].filter(Boolean) } },
    });
    if (ids.template)
      await prisma.certificateTemplate.delete({ where: { id: ids.template } });
    if (ids.signer)
      await prisma.certificateSigner.delete({ where: { id: ids.signer } });
    await prisma.eventAsset.deleteMany({ where: { id: { in: ids.assets } } });
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
