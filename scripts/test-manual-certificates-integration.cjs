const { spawnSync } = require('node:child_process');
const target = process.env.MANUAL_CERTIFICATE_TEST_DATABASE_URL;
if (!target) throw new Error('Configure MANUAL_CERTIFICATE_TEST_DATABASE_URL para banco local disposable_manual_certificates_*.');
const url = new URL(target);
if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/disposable_manual_certificates_')) {
  throw new Error('Somente banco local descartável é permitido neste teste.');
}
const env = { ...process.env, DIRECT_URL: target, DATABASE_URL: target };
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['node_modules/jest/bin/jest.js', '--runInBand', '--runTestsByPath', 'src/public-events/manual-certificates.integration.spec.ts', '--testTimeout=30000'],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
