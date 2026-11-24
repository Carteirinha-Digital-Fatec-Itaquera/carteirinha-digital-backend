/* Cross-repository browser integration. Build both portals against http://localhost:3099 first. */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const backendDir = path.resolve(__dirname, '..');
process.chdir(backendDir);
const database = new URL(process.env.EMPLOYEE_TEST_DATABASE_URL || '');
assert(
  database.hostname === '127.0.0.1' &&
    database.pathname.startsWith('/disposable_employee_'),
  'Somente PostgreSQL local descartável.',
);
process.env.DATABASE_URL = database.href;
process.env.DIRECT_URL = database.href;
process.env.JWT_SECRET =
  process.env.JWT_SECRET || randomBytes(48).toString('hex');
process.env.ATTENDANCE_QR_SECRET =
  process.env.ATTENDANCE_QR_SECRET || randomBytes(48).toString('hex');
process.env.EMPLOYEE_APP_URL = 'http://localhost:4277';
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/database/prisma.service');
const { UploadService } = require('../src/upload/upload.service');
const { MailService } = require('../src/mail/mail.service');
const sharp = require('sharp');
const secretaryDir = path.resolve(
  process.env.SECRETARY_PORTAL_DIR ||
    '../carteirinha-digital-front-end-secretaria',
);
const employeeDir = path.resolve(
  process.env.EMPLOYEE_PORTAL_DIR ||
    '../carteirinha-digital-front-end-funcionarios',
);
const outputDir = path.resolve(
  process.env.PHOTO_TEST_SCREENSHOTS || './artifacts/employee-photos',
);
const employeeOrigin = 'http://localhost:4277';
const secretaryOrigin = 'http://localhost:4287';
const api = 'http://localhost:3099';

async function main() {
  const storage = new Map();
  const fixtureImage = await sharp({
    create: { width: 96, height: 128, channels: 3, background: '#276575' },
  })
    .png()
    .toBuffer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UploadService)
    .useValue({
      uploadPrivateEmployeePhoto: async (bytes, key) => {
        storage.set(key, bytes);
      },
      getPrivateEmployeePhotoBuffer: async (key) => {
        assert(storage.has(key));
        return { buffer: storage.get(key), contentType: 'image/png' };
      },
      deletePrivateEmployeePhoto: async (key) => {
        storage.delete(key);
      },
    })
    .overrideProvider(MailService)
    .useValue({
      sendEmployeeAccessEmail: async () => {
        throw new Error('Este fluxo não deve enviar e-mail.');
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors({
    origin: [employeeOrigin, secretaryOrigin],
    credentials: true,
  });
  let browser;
  const previews = [];
  try {
    await app.listen(3099, '127.0.0.1');
    const prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const secretary = await prisma.secretary.create({
      data: {
        name: 'Secretaria de Teste Local',
        email: randomUUID() + '@cps.sp.gov.br',
        birthDate: new Date('1990-01-01'),
        dueDate: new Date('2030-12-31'),
        password: randomBytes(32).toString('hex'),
      },
    });
    const adminToken = jwt.sign(
      { sub: secretary.id, role: 'secretary' },
      { expiresIn: '30m' },
    );
    async function call(route, token, options = {}) {
      const headers = {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      };
      const response = await fetch(api + route, { ...options, headers });
      assert(response.ok, route + ' HTTP ' + response.status);
      return response.json();
    }
    await prisma.student.create({
      data: {
        ra: String(Date.now()) + '999',
        name: 'Aluno Sintético',
        email: randomUUID() + '@example.test',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        dueDate: new Date('2030-12-31'),
        password: randomBytes(32).toString('hex'),
        photo: 'data:image/png;base64,' + fixtureImage.toString('base64'),
        photoStatus: 'PENDING',
      },
    });
    for (const [root, port] of [
      [secretaryDir, 4287],
      [employeeDir, 4277],
    ]) {
      const { preview } = await import(
        pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
          .href
      );
      previews.push(
        await preview({ root, preview: { port, strictPort: true } }),
      );
    }
    const { chromium } = createRequire(path.join(employeeDir, 'package.json'))(
      'playwright',
    );
    browser = await chromium.launch();
    await fs.mkdir(outputDir, { recursive: true });
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const identity = randomUUID();
      const email = identity + '@example.test';
      const registration = 'FOTO-' + identity.slice(0, 8);
      const name = 'Pessoa Sintética ' + viewport.width;
      const employee = await call('/funcionarios', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          requestId: randomUUID(),
          name,
          email,
          registrationNumber: registration,
          admissionDate: '2024-01-01',
          assignments: [{ title: 'Docente' }],
        }),
      });
      const staffContext = await browser.newContext({
        viewport,
        serviceWorkers: 'block',
      });
      const employeeContext = await browser.newContext({
        viewport,
        serviceWorkers: 'block',
      });
      const allowed = new Set([api, employeeOrigin, secretaryOrigin]);
      for (const context of [staffContext, employeeContext]) {
        context.setDefaultTimeout(30000);
        await context.route('**/*', (route) =>
          allowed.has(new URL(route.request().url()).origin)
            ? route.continue()
            : route.abort(),
        );
      }
      await staffContext.addInitScript(
        (token) => localStorage.setItem('token', token),
        adminToken,
      );
      const staffPage = await staffContext.newPage();
      const employeePage = await employeeContext.newPage();
      const capture = async (page, file) => {
        assert(
          await page
            .locator('body')
            .evaluate((node) => node.scrollWidth <= innerWidth),
          'Rolagem horizontal em ' + file,
        );
        await page.screenshot({
          path: path.join(outputDir, file + '-' + viewport.width + '.png'),
          fullPage: true,
          animations: 'disabled',
        });
      };
      await employeePage.goto(employeeOrigin + '/login');
      await employeePage.getByLabel('E-mail', { exact: true }).fill(email);
      await employeePage
        .getByLabel('Senha', { exact: true })
        .fill(registration);
      await employeePage
        .getByRole('button', { name: 'Entrar', exact: true })
        .click();
      await employeePage
        .getByRole('heading', { name: 'Criar senha pessoal' })
        .waitFor();
      const personalPassword = 'local-' + randomUUID();
      await employeePage
        .getByLabel('Nova senha', { exact: true })
        .fill(personalPassword);
      await employeePage
        .getByLabel('Confirmar nova senha')
        .fill(personalPassword);
      await employeePage.getByRole('button', { name: 'Salvar senha' }).click();
      await employeePage
        .getByRole('heading', { name: 'Login', exact: true })
        .waitFor();
      await employeePage.getByLabel('E-mail', { exact: true }).fill(email);
      await employeePage
        .getByLabel('Senha', { exact: true })
        .fill(personalPassword);
      const sessionResponse = employeePage.waitForResponse(
        (response) =>
          response.url() === api + '/autenticacao/funcionarios/login' &&
          response.status() === 200,
      );
      await employeePage
        .getByRole('button', { name: 'Entrar', exact: true })
        .click();
      const { token } = await (await sessionResponse).json();
      await employeePage.goto(employeeOrigin + '/foto');
      await employeePage
        .getByRole('heading', { name: 'Enviar fotografia' })
        .waitFor();
      await employeePage
        .locator('input[type=file]:not([capture])')
        .setInputFiles({
          name: 'sintetica.png',
          mimeType: 'image/png',
          buffer: fixtureImage,
        });
      await employeePage
        .getByRole('img', { name: 'Prévia da nova foto' })
        .waitFor();
      await employeePage
        .getByRole('button', { name: 'Confirmar Envio' })
        .click();
      await employeePage
        .getByText('Foto recebida e encaminhada para análise.', { exact: true })
        .waitFor();
      await employeePage
        .getByRole('button', { name: 'OK', exact: true })
        .click();
      const pending = await prisma.employeePhoto.findFirstOrThrow({
        where: { employeeId: employee.id, currentPending: true },
      });
      assert.equal(pending.processingState, 'READY');
      const before = await call('/funcionarios/me/carteirinha', token);
      assert.equal(before.credential.reasonCode, 'PHOTO_PENDING');
      await employeePage.goto(employeeOrigin + '/qr');
      await employeePage
        .getByText('Foto em análise.', { exact: true })
        .waitFor();
      await capture(employeePage, 'qr-bloqueado');

      await staffPage.goto(secretaryOrigin + '/fotos');
      await staffPage
        .getByRole('button', { name: /Funcionários [(]1[)]/ })
        .waitFor();
      await staffPage.getByRole('button', { name: /Alunos [(]1[)]/ }).waitFor();
      await staffPage
        .getByRole('checkbox', { name: 'Selecionar foto de Aluno Sintético' })
        .waitFor();
      await staffPage
        .getByRole('button', { name: /Funcionários [(]1[)]/ })
        .click();
      await staffPage.getByRole('heading', { name, exact: true }).waitFor();
      await staffPage
        .getByRole('button', { name: 'Ampliar foto de ' + name })
        .click();
      await staffPage
        .getByRole('img', { name: 'Foto completa de ' + name })
        .waitFor();
      await capture(staffPage, 'foto-privada-ampliada');
      await staffPage
        .getByRole('button', { name: 'Fechar visualização da foto' })
        .click();
      await capture(staffPage, 'fila-funcionarios');
      await staffPage
        .getByRole('button', { name: 'Aprovar foto', exact: true })
        .click();
      await capture(staffPage, 'confirmar-aprovacao');
      await staffPage
        .getByRole('button', { name: 'Confirmar aprovação' })
        .click();
      await staffPage
        .getByText('Foto do funcionário aprovada.', { exact: true })
        .waitFor();
      await staffPage
        .getByRole('button', { name: /Funcionários [(]0[)]/ })
        .waitFor();
      await staffPage.getByRole('button', { name: /Alunos [(]1[)]/ }).waitFor();
      const approved = await call('/funcionarios/me/foto', token);
      assert.equal(approved.approved.id, pending.id);
      const card = await call('/funcionarios/me/carteirinha', token);
      assert(card.credential.valid);
      await employeePage.goto(employeeOrigin + '/qr');
      await employeePage
        .getByRole('link', { name: 'Abrir página de validação' })
        .waitFor();
      const realLink = await employeePage
        .getByRole('link', { name: 'Abrir página de validação' })
        .getAttribute('href');
      assert.equal(realLink, card.verificationUrl);
      assert(
        await employeePage
          .locator('svg')
          .filter({
            has: employeePage.locator('title', {
              hasText: 'QR Code da carteirinha',
            }),
          })
          .count(),
      );
      await capture(employeePage, 'qr-aprovado-real');
      await employeePage
        .getByRole('link', { name: 'Abrir página de validação' })
        .click();
      await employeePage.getByText(name, { exact: true }).waitFor();
      const publicResult = await call('/funcionarios/verificar/' + card.qrcode);
      assert(publicResult.valid);
      assert(!Object.hasOwn(publicResult, 'email'));

      await employeePage.goto(employeeOrigin + '/foto');
      await employeePage
        .locator('input[type=file]:not([capture])')
        .setInputFiles({
          name: 'substituta.png',
          mimeType: 'image/png',
          buffer: fixtureImage,
        });
      await employeePage
        .getByRole('img', { name: 'Prévia da nova foto' })
        .waitFor();
      await employeePage
        .getByRole('button', { name: 'Confirmar Envio' })
        .click();
      await employeePage
        .getByRole('button', { name: 'Enviar nova foto', exact: true })
        .click();
      await employeePage
        .getByText('Foto recebida e encaminhada para análise.', { exact: true })
        .waitFor();
      await employeePage
        .getByRole('button', { name: 'OK', exact: true })
        .click();
      assert(
        (await call('/funcionarios/me/carteirinha', token)).credential.valid,
      );
      await staffPage.goto(secretaryOrigin + '/fotos');
      await staffPage
        .getByRole('button', { name: /Funcionários [(]1[)]/ })
        .click();
      await staffPage
        .getByRole('button', { name: 'Rejeitar foto', exact: true })
        .click();
      await staffPage
        .getByRole('textbox', { name: 'Motivo da rejeição' })
        .fill('Imagem sintética fora do enquadramento.');
      await capture(staffPage, 'confirmar-rejeicao');
      await staffPage
        .getByRole('button', { name: 'Confirmar rejeição' })
        .click();
      await staffPage
        .getByText('Foto do funcionário rejeitada.', { exact: true })
        .waitFor();
      await employeePage.goto(employeeOrigin + '/foto');
      await employeePage
        .getByText('Imagem sintética fora do enquadramento.', { exact: true })
        .waitFor();
      await employeePage
        .getByText(
          'A última foto enviada foi rejeitada. Sua foto aprovada anteriormente continua na carteirinha.',
          { exact: true },
        )
        .waitFor();
      await capture(employeePage, 'rejeicao-substituta');
      assert(
        (await call('/funcionarios/me/carteirinha', token)).credential.valid,
      );
      const details = await call('/funcionarios/' + employee.id, adminToken);
      await call(
        '/funcionarios/' + employee.id + '/qrcode/renovar',
        adminToken,
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedVersion: details.version,
            reason: 'Revogação de teste isolado.',
          }),
        },
      );
      const revoked = await fetch(
        api + '/funcionarios/verificar/' + card.qrcode,
      );
      assert.equal(revoked.status, 404);
      await staffContext.close();
      await employeeContext.close();
      console.log(
        'Fluxo HTTP real com PostgreSQL e armazenamento simulado aprovado em ' +
          viewport.width +
          'x' +
          viewport.height,
      );
    }
  } finally {
    if (browser) await browser.close();
    for (const server of previews)
      await new Promise((resolve) => server.httpServer.close(resolve));
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
