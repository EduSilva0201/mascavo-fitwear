import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'mascavo-local',
    '--local',
    '--file',
    'backend/seeds/testimonials-demo.sql',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: resolve('.wrangler/logs'),
    },
  },
);
process.exitCode = result.status ?? 1;
