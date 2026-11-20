import { spawnSync } from 'node:child_process';
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[a-z0-9.!#$%+_=-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email))
  throw new Error('Uso: npm.cmd run admin:grant -- email@exemplo.com [--revoke]');
const role = process.argv.includes('--revoke') ? 'customer' : 'admin';
const command = `UPDATE customers SET role='${role}' WHERE email='${email}' AND status='active' AND email_verified_at IS NOT NULL; SELECT email,role FROM customers WHERE email='${email}';`;
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'mascavo-local',
    '--local',
    '--command',
    command,
  ],
  { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
process.exitCode = result.status ?? 1;
