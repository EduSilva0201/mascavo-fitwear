import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Restrict this entry point to local operations and bundle validation.
const operation = process.argv[2];
const operations = {
  // Disable terminal shortcuts that can switch this local session to remote preview.
  dev: ['dev', '--local', '--show-interactive-dev-session=false'],
  migrate: ['d1', 'migrations', 'apply', 'mascavo-local', '--local'],
  build: ['deploy', '--dry-run', '--outdir', 'dist/worker'],
};
if (!operations[operation]) throw new Error('Operação local inválida.');
const child = spawn(
  process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', ...operations[operation]],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: resolve('.wrangler/logs'),
      WRANGLER_SEND_METRICS: 'false',
    },
  },
);
child.on('exit', (code) => (process.exitCode = code ?? 1));
child.on('error', () => {
  console.error('Não foi possível iniciar Wrangler.');
  process.exitCode = 1;
});
