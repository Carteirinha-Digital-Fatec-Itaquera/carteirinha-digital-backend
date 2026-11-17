const { spawnSync } = require('node:child_process');

const target = process.env.EMPLOYEE_TEST_DATABASE_URL;
if (!target) {
  throw new Error(
    'Configure EMPLOYEE_TEST_DATABASE_URL para banco local disposable_employee_*.',
  );
}

const url = new URL(target);
if (
  url.hostname !== '127.0.0.1' ||
  !url.pathname.startsWith('/disposable_employee_')
) {
  throw new Error(
    'Somente banco local descartável (127.0.0.1 e prefixo disposable_employee_) é permitido neste runner.',
  );
}

const env = { ...process.env, DIRECT_URL: target, DATABASE_URL: target };
const testPaths = process.argv.slice(2);
const targets =
  testPaths.length > 0
    ? testPaths
    : [
        'src/employee/employee.integration.spec.ts',
        'src/attendance/employee-attendance.integration.spec.ts',
      ];

for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  [
    'node_modules/jest/bin/jest.js',
    '--runInBand',
    '--runTestsByPath',
    ...targets,
    '--testTimeout=45000',
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
