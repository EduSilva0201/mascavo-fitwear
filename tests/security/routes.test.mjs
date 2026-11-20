import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, quote, payment, origin } from '../support/worker.mjs';
let app;
before(async () => {
  app = await createWorker();
});
after(async () => app?.dispose());
test('security: payment and freight require session, same origin, CSRF and JSON', async () => {
  const c = await app.client();
  for (const path of ['/api/v1/integrations/payments', '/api/v1/integrations/shipping/quote']) {
    const anonymous = await app.runtime.dispatchFetch(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(anonymous.status, 401);
    for (const headers of [
      { 'X-CSRF-Token': '' },
      { Origin: 'https://attacker.test' },
      { 'Content-Type': 'text/plain' },
    ]) {
      const r = await c.call(path, {}, headers);
      assert.ok([403, 415].includes(r.status));
    }
  }
  assert.equal(app.calls.length, 0);
});
test('security: no status or payment response exposes provider credentials or full CPF', async () => {
  const c = await app.client(),
    q = await quote(c),
    p = await c.call('/api/v1/integrations/payments', payment(q.body.quoteId));
  for (const body of [(await c.call('/api/v1/integrations/status')).body, q.body, p.body]) {
    const json = JSON.stringify(body);
    for (const secret of [
      'fixture-asaas-not-a-real-key',
      'fixture-shipping-not-a-real-token',
      '52998224725',
    ])
      assert.equal(json.includes(secret), false);
  }
  assert.equal(p.status, 201);
  assert.equal(p.body.paid, undefined);
  assert.equal((await c.call('/api/v1/orders', {})).status, 400);
});
test('security: a customer cannot use admin APIs or access another customers quote', async () => {
  const c = await app.client(),
    other = await app.client(),
    q = await quote(c);
  assert.equal((await c.call('/api/v1/admin/catalog')).status, 403);
  assert.equal(
    (await other.call('/api/v1/integrations/payments', payment(q.body.quoteId))).status,
    409,
  );
});
test('security: stock disappearing after freight quote blocks payment', async () => {
  const c = await app.client(),
    q = await quote(c);
  app.reset();
  await app.db
    .prepare(
      "UPDATE catalog_variants SET stock=0 WHERE product_id=14 AND color='Preto' AND size='M'",
    )
    .run();
  assert.equal(
    (await c.call('/api/v1/integrations/payments', payment(q.body.quoteId))).status,
    400,
  );
  assert.equal(app.calls.length, 0);
});
