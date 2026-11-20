import { config } from './melhorenvio-oauth.mjs';

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const env = await config();
    if (!env.COMMERCE_MAINTENANCE_TOKEN)
      throw Error('Configure COMMERCE_MAINTENANCE_TOKEN em .dev.vars.');
    const r = await fetch('http://127.0.0.1:8787/api/v1/webhooks/process', {
      method: 'POST',
      headers: { 'X-Maintenance-Token': env.COMMERCE_MAINTENANCE_TOKEN },
      signal: AbortSignal.timeout(120000),
    });
    console.log(`Manutencao de pedidos: HTTP ${r.status}`);
  } catch {
    console.error('Manutencao indisponivel; nova tentativa em 30s.');
  } finally {
    running = false;
  }
}
await tick();
setInterval(tick, 30000);
