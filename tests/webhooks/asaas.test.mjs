import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, origin } from '../support/worker.mjs';

test('Asaas webhook authenticates and persists duplicate events only once', async () => {
  const worker = await createWorker();
  try {
    const send = (token, body) => worker.runtime.dispatchFetch(origin + '/api/v1/webhooks/asaas', {
      method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': token },
      body: JSON.stringify(body),
    });
    const token = 'fixture-webhook-token-with-at-least-32-characters';
    const event = { id: 'evt_test', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_test' } };
    assert.equal((await send('', event)).status, 401);
    assert.equal((await send('invalid', event)).status, 401);
    assert.equal((await send(token, {})).status, 400);
    assert.equal((await send(token, event)).status, 200);
    assert.equal((await send(token, event)).status, 200);
    const row = await worker.db.prepare('SELECT COUNT(*) AS total FROM sandbox_asaas_events').first();
    assert.equal(row.total, 1);
    const remote = await worker.runtime.dispatchFetch('https://example.com/api/v1/auth/me');
    assert.equal(remote.status, 503);
  } finally { await worker.dispose(); }
});
