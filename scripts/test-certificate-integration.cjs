const { spawnSync } = require('node:child_process');
const target = process.env.CERTIFICATE_TEST_DATABASE_URL;
if (!target) throw new Error('Configure CERTIFICATE_TEST_DATABASE_URL para um PostgreSQL local dedicado issue27_*.');
const url = new URL(target);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.startsWith('/issue27_')) {
  throw new Error('Por segurança, somente banco local issue27_* é aceito por este teste.');
}
const env = { ...process.env, DIRECT_URL: target, DATABASE_URL: target };
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['node_modules/jest/bin/jest.js', '--runInBand', '--runTestsByPath', 'src/certificate/certificate.integration.spec.ts', '--testTimeout=30000'],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
