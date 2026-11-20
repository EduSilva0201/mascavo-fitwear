import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWorker, origin } from '../support/worker.mjs';

test('Melhor Envio: authenticated registration probes are durable, deduplicated and never update shipments', async () => {
  const app = await createWorker();
  try {
    const send = (raw, signature) => app.runtime.dispatchFetch(origin + '/api/v1/webhooks/melhorenvio', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ME-Signature': signature || '' }, body: raw,
    });
    for (const raw of ['{}', JSON.stringify({ event: 'webhook.test', data: {} }), 'test']) {
      const signature = createHmac('sha256', 'fixture-shipping-client-secret').update(raw).digest('base64');
      assert.equal((await send(raw)).status, 401);
      assert.equal((await send(raw + ' ', signature)).status, 401);
      assert.equal((await send(raw, signature)).status, 200);
      assert.equal((await send(raw, signature)).status, 200);
    }
    const events = await app.db.prepare("SELECT * FROM commerce_events WHERE provider='shipping'").all();
    assert.equal(events.results.length, 3);
    assert.ok(events.results.every(e => e.state === 'review' && e.resource_id === 'unrecognized'));
    assert.equal((await app.db.prepare('SELECT COUNT(*) n FROM shipments').first()).n, 0);
    assert.equal(app.calls.length, 0);
  } finally { await app.dispose(); }
});
