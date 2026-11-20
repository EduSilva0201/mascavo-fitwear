import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const suite = process.argv[2] || 'all';
const units = [
  'tests/unit/provider-read.test.mjs',
  'tests/unit/melhorenvio-oauth.test.mjs',
  'tests/integrations.test.mjs',
  'tests/unit/providers-extra.test.mjs',
  'tests/unit/report.test.mjs',
];
const simulated = [
  'tests/integration/sender-pf.test.mjs',
  'tests/webhooks/melhorenvio-registration.test.mjs',
  'tests/integration/shipping-oauth.test.mjs',
  'tests/integration/commerce.test.mjs',
  'tests/webhooks/asaas.test.mjs',
  'tests/integration/asaas.test.mjs',
  'tests/integration/melhorenvio.test.mjs',
  'tests/integration/content.test.mjs',
  'tests/security/routes.test.mjs',
  'tests/security/staging.test.mjs',
];
const groups = {
  all: [...units, ...simulated, 'tests/auth.test.mjs'],
  unit: units,
  integration: simulated,
  asaas: [...units, 'tests/integration/asaas.test.mjs'],
  melhorenvio: [...units, 'tests/integration/melhorenvio.test.mjs'],
  security: ['tests/security/routes.test.mjs', 'tests/security/staging.test.mjs'],
  webhooks: ['tests/webhooks/asaas.test.mjs', 'tests/webhooks/melhorenvio-registration.test.mjs', 'tests/integration/commerce.test.mjs'],
  checkout: ['tests/auth.test.mjs', 'tests/integration/commerce.test.mjs'],
  email: ['tests/integration/commerce.test.mjs'],
  e2e: ['tests/auth.test.mjs'],
  coverage: units,
  sandbox: ['tests/sandbox/live.test.mjs'],
};
if (!groups[suite]) throw Error('Unknown test suite');
if (suite === 'sandbox' && process.env.RUN_SANDBOX_TESTS !== '1') {
  console.error(
    'Sandbox desativado. Configure as credenciais exclusivas de teste e RUN_SANDBOX_TESTS=1 explicitamente. Consulte TESTING.md.',
  );
  process.exit(1);
}
const reportDir = resolve('test-results', 'reports', suite);
await mkdir(reportDir, { recursive: true });
const args = [
  '--test',
  '--test-concurrency=1',
  '--test-reporter=./tests/support/report.mjs',
  '--test-reporter-destination=stdout',
];
if (suite === 'coverage')
  args.push(
    '--experimental-test-coverage',
    '--test-coverage-include=backend/src/modules/integrations/providers.ts',
    '--test-coverage-include=backend/src/modules/integrations/checkout.ts',
    '--test-coverage-lines=90',
    '--test-coverage-branches=85',
    '--test-coverage-functions=85',
  );
const env = {
  ...process.env,
  TEST_REPORT_DIR: reportDir,
  TEST_SUITE: suite,
  WRANGLER_SEND_METRICS: 'false',
};
if (suite !== 'sandbox')
  for (const key of Object.keys(env))
    if (/ASAAS|MELHOR_ENVIO|RESEND|CLOUDFLARE_API|CF_API|AWS_|SMTP/.test(key)) delete env[key];
const child = spawn(process.execPath, [...args, ...groups[suite]], { stdio: 'inherit', env });
child.on('error', () => {
  console.error('Não foi possível iniciar os testes.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  console.log('Relatório: ' + resolve(reportDir, 'index.html'));
  process.exitCode = code ?? 1;
});
