import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, quote, payment, cart } from '../support/worker.mjs';
let app;
before(async () => {
  app = await createWorker();
});
after(async () => {
  await app?.dispose();
});
beforeEach(() => app.reset());
test('melhorenvio: quotes multiple variants with server dimensions, origin, insurance and quantities', async () => {
  const c = await app.client(),
    r = await quote(c, [...cart, { id: 14, color: 'Vinho', size: 'M', qty: 2 }]);
  assert.equal(r.status, 200);
  assert.equal(r.body.rates.length, 2);
  assert.equal(r.body.rates[1].priceCents, 4183);
  assert.equal(r.body.subtotalCents, 51000);
  const sent = app.calls[0].body;
  assert.equal(sent.from.postal_code, '73060604');
  assert.equal(sent.to.postal_code, '04794000');
  assert.deepEqual(
    sent.products.map((p) => p.quantity),
    [1, 2],
  );
  assert.equal(sent.products[0].weight, 0.3);
  assert.equal(sent.products[0].width, 20);
  assert.equal(sent.products[0].insurance_value, 170);
});
test('melhorenvio: invalid CEP, duplicate variants and stock overflow fail before API', async () => {
  const c = await app.client();
  for (const data of [
    { items: cart, cep: '123' },
    { items: [...cart, ...cart], cep: '04794000' },
    { items: [{ ...cart[0], qty: 6 }], cep: '04794000' },
  ])
    assert.equal((await c.call('/api/v1/integrations/shipping/quote', data)).status, 400);
  assert.equal(app.calls.length, 0);
});
test('melhorenvio: excludes unavailable services and handles no rates', async () => {
  const c = await app.client();
  app.mock(() =>
    Response.json([
      null,
      7,
      { id: 1, error: 'unavailable' },
      { id: 2, price: 'NaN', delivery_time: 1 },
    ]),
  );
  const r = await quote(c);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rates, []);
  assert.equal(
    (await c.call('/api/v1/integrations/payments', payment(r.body.quoteId))).status,
    400,
  );
});
for (const status of [401, 422, 429, 500])
  test(`melhorenvio: provider HTTP ${status} is sanitized`, async () => {
    const c = await app.client();
    app.mock(() => Response.json({ secret: 'not-for-customer' }, { status }));
    const r = await quote(c);
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Melhor Envio/);
    assert.equal(JSON.stringify(r.body).includes('not-for-customer'), false);
  });
test('melhorenvio: malformed provider response fails without saving a quote', async () => {
  const c = await app.client();
  app.mock(() => Response.json({ unexpected: true }));
  assert.equal((await quote(c)).status, 502);
  assert.equal(
    (
      await app.db
        .prepare('SELECT COUNT(*) n FROM sandbox_shipping_quotes WHERE customer_id=?')
        .bind(c.id)
        .first()
    ).n,
    0,
  );
});
test('melhorenvio: expired, foreign, modified-cart and changed-price quotes cannot be charged', async () => {
  const c = await app.client(),
    other = await app.client();
  let q = await quote(c);
  app.reset();
  assert.equal(
    (await other.call('/api/v1/integrations/payments', payment(q.body.quoteId))).status,
    409,
  );
  assert.equal(
    (
      await c.call(
        '/api/v1/integrations/payments',
        payment(q.body.quoteId, { items: [{ ...cart[0], qty: 2 }] }),
      )
    ).status,
    409,
  );
  await app.db
    .prepare('UPDATE sandbox_shipping_quotes SET expires_at=0 WHERE id=?')
    .bind(q.body.quoteId)
    .run();
  assert.equal(
    (await c.call('/api/v1/integrations/payments', payment(q.body.quoteId))).status,
    409,
  );
  q = await quote(c);
  app.reset();
  await app.db.prepare('UPDATE catalog_products SET price_cents=18000 WHERE id=14').run();
  assert.equal(
    (await c.call('/api/v1/integrations/payments', payment(q.body.quoteId))).status,
    409,
  );
  await app.db.prepare('UPDATE catalog_products SET price_cents=17000 WHERE id=14').run();
  assert.equal(app.calls.length, 0);
});
