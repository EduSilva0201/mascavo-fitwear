import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, quote, payment } from '../support/worker.mjs';
let app;
before(async () => {
  app = await createWorker();
});
after(async () => {
  await app?.dispose();
});
beforeEach(() => app.reset());

for (const [billingType, installments] of [
  ['PIX', 1],
  ['BOLETO', 1],
  ['CREDIT_CARD', 1],
  ['CREDIT_CARD', 2],
  ['CREDIT_CARD', 3],
]) {
  test(`asaas: creates ${billingType} ${installments}x with authoritative prices and freight`, async () => {
    const client = await app.client(),
      q = await quote(client);
    assert.equal(q.status, 200);
    const r = await client.call(
      '/api/v1/integrations/payments',
      payment(q.body.quoteId, { billingType, installments }),
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.amountCents, 19206);
    const sent = app.calls.find((c) => c.path === '/v3/payments').body;
    assert.equal(sent.billingType, billingType);
    if (installments > 1) {
      assert.equal(sent.totalValue, 192.06);
      assert.equal(sent.installmentCount, installments);
      assert.equal('value' in sent, false);
    } else {
      assert.equal(sent.value, 192.06);
      assert.equal('installmentCount' in sent, false);
    }
    assert.equal(app.calls[1].body.notificationDisabled, true);
    const row = await app.db
      .prepare('SELECT * FROM sandbox_payments WHERE provider_id=? AND customer_id=?')
      .bind('pay_fixture', client.id)
      .first();
    assert.equal(row.state, 'created');
    assert.equal(row.amount_cents, 19206);
    assert.equal(app.unexpected.length, 0);
  });
}
test('asaas: rejects browser price tampering and installments over three', async () => {
  const c = await app.client(),
    q = await quote(c);
  app.reset();
  for (const extra of [
    { amountCents: 1 },
    { shippingPrice: 0 },
    { items: [{ id: 14, color: 'Preto', size: 'M', qty: 1, price: 0.01 }] },
    { billingType: 'CREDIT_CARD', installments: 4 },
    { billingType: 'BOLETO', installments: 2 },
  ]) {
    assert.equal(
      (await c.call('/api/v1/integrations/payments', payment(q.body.quoteId, extra))).status,
      400,
    );
  }
  assert.equal(app.calls.length, 0);
});
test('asaas: retries same key without a second customer or charge; changed body conflicts', async () => {
  const c = await app.client(),
    q = await quote(c),
    body = payment(q.body.quoteId);
  const first = await c.call('/api/v1/integrations/payments', body);
  assert.equal(first.status, 201);
  app.reset();
  const again = await c.call('/api/v1/integrations/payments', body);
  assert.equal(again.status, 200);
  assert.equal(again.body.invoiceUrl, first.body.invoiceUrl);
  assert.equal(app.calls.length, 0);
  assert.equal(
    (await c.call('/api/v1/integrations/payments', { ...body, billingType: 'BOLETO' })).status,
    409,
  );
});
test('asaas: concurrent attempts with same key create one payment', async () => {
  const c = await app.client(),
    q = await quote(c),
    body = payment(q.body.quoteId);
  app.reset();
  const results = await Promise.all([
    c.call('/api/v1/integrations/payments', body),
    c.call('/api/v1/integrations/payments', body),
  ]);
  assert.ok(results.some((r) => r.status === 201));
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)));
  assert.equal(app.calls.filter((c) => c.path === '/v3/payments').length, 1);
});
for (const status of [401, 403, 429, 500])
  test(`asaas: HTTP ${status} leaves a reviewable attempt and does not retry`, async () => {
    const c = await app.client(),
      q = await quote(c),
      body = payment(q.body.quoteId);
    app.reset();
    app.mock((call) =>
      call.path === '/v3/payments'
        ? Response.json({ secret: 'must-not-leak' }, { status })
        : undefined,
    );
    const r = await c.call('/api/v1/integrations/payments', body);
    assert.equal(r.status, 502);
    assert.equal(JSON.stringify(r.body).includes('must-not-leak'), false);
    assert.equal((await c.call('/api/v1/integrations/payments', body)).status, 409);
    assert.equal(app.calls.filter((c) => c.path === '/v3/payments').length, 1);
    assert.equal(
      (
        await app.db
          .prepare('SELECT state FROM sandbox_payments WHERE request_key=?')
          .bind(body.requestKey)
          .first()
      ).state,
      'review',
    );
  });
for (const response of [
  () => new Response('not-json'),
  () => Response.json({ id: 'pay_fixture', invoiceUrl: 'https://example.test/steal' }),
  () => Response.json({ id: 'pay_fixture' }),
]) {
  test('asaas: malformed payment response never exposes an external invoice link or retries', async () => {
    const c = await app.client(),
      q = await quote(c),
      body = payment(q.body.quoteId);
    app.reset();
    app.mock((call) => (call.path === '/v3/payments' ? response() : undefined));
    const r = await c.call('/api/v1/integrations/payments', body);
    assert.ok(r.status >= 400);
    assert.equal('invoiceUrl' in r.body, false);
    assert.equal((await c.call('/api/v1/integrations/payments', body)).status, 409);
  });
}
test('asaas: missing CPF prevents requests to financial API', async () => {
  const c = await app.client({ profile: false }),
    q = await quote(c);
  app.reset();
  assert.equal(
    (await c.call('/api/v1/integrations/payments', payment(q.body.quoteId))).status,
    400,
  );
  assert.equal(app.calls.length, 0);
});
