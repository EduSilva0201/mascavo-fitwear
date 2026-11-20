import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { createWorker, cart, origin } from '../support/worker.mjs';

const sender = {
  name: 'Mascavo Teste',
  phone: '61999999999',
  email: 'loja@example.test',
  company_document: '12345678000195',
  state_register: '123456789',
  address: 'Rua Teste',
  number: '1',
  complement: '',
  district: 'Centro',
  city: 'Brasilia',
  state_abbr: 'DF',
  postal_code: '73060604',
};
const pack = { weight: 0.3, width: 20, height: 4, length: 25 };
const token = 'fixture-webhook-token-with-at-least-32-characters';
async function fixture() {
  const app = await createWorker(),
    customer = await app.client(),
    admin = await app.client({ role: 'admin' });
  const addressId = randomUUID();
  await app.db
    .prepare('INSERT INTO customer_addresses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(
      addressId,
      customer.id,
      'Casa',
      'Cliente Ficticio',
      '04794000',
      'Rua Ficticia',
      '10',
      '',
      'Centro',
      'Sao Paulo',
      'SP',
      Math.floor(Date.now() / 1000),
    )
    .run();
  await app.db
    .prepare('INSERT INTO sku_packages VALUES (?,?,?,?)')
    .bind(14, 'Preto', 'M', JSON.stringify(pack))
    .run();
  const payments = new Map(),
    labels = new Map();
  let labelSeq = 0,
    chargeSeq = 0,
    override = () => undefined;
  app.mock((call) => {
    const replacement = override(call);
    if (replacement !== undefined) return replacement;
    if (call.path === '/api/v2/me/shipment/calculate')
      return Response.json([
        {
          id: 1,
          name: 'PAC',
          company: { name: 'Correios' },
          price: '22.06',
          delivery_time: 5,
          packages: [{ weight: 0.3, dimensions: { width: 20, height: 4, length: 25 } }],
        },
      ]);
    if (call.path === '/v3/payments' && call.method === 'POST') {
      const id = 'pay_' + ++chargeSeq;
      payments.set(id, {
        id,
        customer: call.body.customer,
        externalReference: call.body.externalReference,
        value: call.body.value,
        status: 'PENDING',
      });
      return Response.json({ id, invoiceUrl: 'https://sandbox.asaas.com/i/' + id });
    }
    if (call.path.startsWith('/v3/payments/'))
      return Response.json(payments.get(call.path.split('/').at(-1)) || {}, {
        status: payments.has(call.path.split('/').at(-1)) ? 200 : 404,
      });
    if (call.path === '/api/v2/me/cart') {
      const id = 'label_' + ++labelSeq;
      labels.set(id, { id, status: 'pending', created_at: '2026-11-14T10:00:00Z' });
      return Response.json({ id });
    }
    if (call.path === '/api/v2/me/shipment/tracking')
      return Response.json(Object.fromEntries(call.body.orders.map((id) => [id, labels.get(id)])));
    if (call.path === '/api/v2/me/shipment/checkout') {
      for (const id of call.body.orders) labels.get(id).status = 'released';
      return Response.json({ purchase: { status: 'paid' } });
    }
    if (call.path === '/api/v2/me/shipment/generate') {
      for (const id of call.body.orders) labels.get(id).status = 'generated';
      return Response.json({});
    }
    if (call.path === '/api/v2/me/shipment/print')
      return Response.json({ url: 'https://sandbox.melhorenvio.com.br/print/test' });
    if (call.path === '/api/v2/me/shipment/cancel') {
      labels.get(call.body.order.id).status = 'cancelled';
      return Response.json({});
    }
  });
  const quote = async (c = customer) =>
    c.call('/api/v1/integrations/shipping/quote', { items: cart, cep: '04794000' });
  const make = async (overrides = {}) => {
    const q = await quote();
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const payload = {
      items: cart,
      addressId,
      quoteId: q.body.quoteId,
      serviceId: '1',
      requestKey: randomUUID(),
      billingType: 'PIX',
      installments: 1,
      ...overrides,
    };
    const result = await customer.call('/api/v1/orders', payload);
    return { ...result, payload };
  };
  const webhook = async (body, auth = token) => {
    const r = await app.runtime.dispatchFetch(origin + '/api/v1/webhooks/asaas', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'asaas-access-token': auth },
      body: JSON.stringify(body),
    });
    return r.status;
  };
  const flush = async () => {
    const r = await app.runtime.dispatchFetch(origin + '/api/v1/webhooks/process', {
      method: 'POST',
      headers: { 'X-Maintenance-Token': 'fixture-maintenance-token-at-least-32-characters' },
    });
    assert.equal(r.status, 200);
  };
  return {
    app,
    customer,
    admin,
    addressId,
    payments,
    labels,
    quote,
    make,
    webhook,
    flush,
    override(fn) {
      override = fn;
    },
  };
}

test('commerce: immutable snapshots, payment connection, idempotency and atomic last-item reservation', async () => {
  const f = await fixture();
  try {
    await f.app.db
      .prepare(
        "UPDATE catalog_variants SET stock=1 WHERE product_id=14 AND color='Preto' AND size='M'",
      )
      .run();
    const q = await f.quote();
    const payload = {
      items: cart,
      addressId: f.addressId,
      quoteId: q.body.quoteId,
      serviceId: '1',
      requestKey: randomUUID(),
      billingType: 'PIX',
      installments: 1,
    };
    const results = await Promise.all([
      f.customer.call('/api/v1/orders', payload),
      f.customer.call('/api/v1/orders', { ...payload, requestKey: randomUUID() }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const win = results.find((r) => r.status === 201),
      id = win.body.orderId;
    assert.equal(f.payments.size, 1);
    assert.equal(
      (
        await f.app.db
          .prepare('SELECT stock FROM catalog_variants WHERE product_id=14 AND color=? AND size=?')
          .bind('Preto', 'M')
          .first()
      ).stock,
      0,
    );
    const row = await f.app.db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    const original = JSON.parse(row.snapshot_json);
    assert.equal(original.address.street, 'Rua Ficticia');
    assert.equal(original.customer.cpf, '52998224725');
    assert.equal(row.provider_id, [...f.payments.keys()][0]);
    assert.equal(row.amount_cents, 19206);
    await f.app.db
      .prepare("UPDATE customer_addresses SET street='Mudou' WHERE id=?")
      .bind(f.addressId)
      .run();
    assert.equal(
      JSON.parse(
        (await f.app.db.prepare('SELECT snapshot_json FROM orders WHERE id=?').bind(id).first())
          .snapshot_json,
      ).address.street,
      'Rua Ficticia',
    );
    const other = await f.app.client();
    assert.equal((await other.call('/api/v1/orders/' + id)).status, 404);
    assert.equal((await other.call('/api/v1/orders/' + id + '/reconcile', {})).status, 404);
    const retry = await f.customer.call('/api/v1/orders', JSON.parse(row.request_json));
    assert.equal(retry.body.orderId, id);
    assert.equal(f.payments.size, 1);
  } finally {
    await f.app.dispose();
  }
});

test('commerce: full payment-to-delivery, fiscal gating, one label purchase, print and local notifications', async () => {
  const f = await fixture();
  try {
    const made = await f.make();
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.orderId;
    const p = [...f.payments.values()][0];
    assert.equal((await f.admin.call(`/api/v1/orders/${id}/shipment`, {})).status, 409);
    p.status = 'RECEIVED';
    assert.equal(
      (await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).body.paymentState,
      'paid',
    );
    assert.equal((await f.admin.call(`/api/v1/orders/${id}/shipment`, {})).status, 409);
    assert.equal((await f.admin.call('/api/v1/orders/shipping-settings', sender)).status, 200);
    assert.equal(
      (await f.admin.call(`/api/v1/orders/${id}/fiscal`, { key: '1'.repeat(44) })).status,
      200,
    );
    const prepared = await f.admin.call(`/api/v1/orders/${id}/shipment`, {});
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const sid = prepared.body.shipment.id;
    const act = (action) => f.admin.call(`/api/v1/orders/${id}/shipment/${sid}/${action}`, {});
    assert.equal((await act('purchase')).status, 409);
    assert.equal((await act('cart')).status, 200);
    assert.equal((await act('cart')).status, 200);
    assert.equal((await act('print')).status, 409);
    assert.equal((await act('purchase')).body.shipment.state, 'released');
    assert.equal((await act('purchase')).status, 200);
    assert.equal((await act('generate')).body.shipment.state, 'generated');
    assert.equal((await act('generate')).status, 200);
    assert.equal(
      (await act('print')).body.shipment.print_url,
      'https://sandbox.melhorenvio.com.br/print/test',
    );
    assert.equal((await act('print')).status, 200);
    assert.equal(f.app.calls.filter((c) => c.path === '/api/v2/me/cart').length, 1);
    assert.equal(f.app.calls.filter((c) => c.path === '/api/v2/me/shipment/checkout').length, 1);
    let messages = await f.admin.call('/api/v1/orders/mail');
    assert.deepEqual(messages.body.messages.map((m) => m.subject).sort(), [
      'order_created',
      'payment_confirmed',
    ]);
    const label = [...f.labels.values()][0];
    assert.equal((await f.customer.call('/api/v1/orders/' + id)).body.shipments[0].tracking, null);
    label.status = 'posted';
    label.posted_at = '2026-11-14T12:00:00Z';
    assert.equal((await act('reconcile')).body.shipment.state, 'posted');
    label.tracking = 'TEST123';
    label.tracking_url = 'https://www.melhorrastreio.com.br/rastreio/TEST123';
    await act('reconcile');
    await act('reconcile');
    label.status = 'delivered';
    label.delivered_at = '2026-11-14T13:00:00Z';
    await act('reconcile');
    const view = await f.customer.call('/api/v1/orders/' + id);
    assert.equal(view.body.shipments[0].state, 'delivered');
    messages = await f.admin.call('/api/v1/orders/mail');
    assert.equal(messages.body.messages.filter((m) => m.subject === 'shipment_posted').length, 1);
    assert.equal(
      messages.body.messages.filter((m) => m.subject === 'tracking_available').length,
      1,
    );
    assert.equal(
      messages.body.messages.filter((m) => m.subject === 'shipment_delivered').length,
      1,
    );
    assert.equal(f.app.unexpected.length, 0);
  } finally {
    await f.app.dispose();
  }
});

test('commerce: expiration releases stock once and a late payment is held for review', async () => {
  const f = await fixture();
  try {
    const made = await f.make();
    const id = made.body.orderId;
    await f.app.db.prepare('UPDATE orders SET expires_at=0 WHERE id=?').bind(id).run();
    await f.flush();
    await f.flush();
    assert.equal(
      (
        await f.app.db
          .prepare(
            "SELECT stock FROM catalog_variants WHERE product_id=14 AND color='Preto' AND size='M'",
          )
          .first()
      ).stock,
      5,
    );
    [...f.payments.values()][0].status = 'RECEIVED';
    assert.equal(
      (await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).body.paymentState,
      'late_payment',
    );
    assert.equal((await f.admin.call(`/api/v1/orders/${id}/shipment`, {})).status, 409);
  } finally {
    await f.app.dispose();
  }
});

test('commerce: verifies owner/reference/value, persists webhook before processing, blocks refunds and ignores stale pending', async () => {
  const f = await fixture();
  try {
    const made = await f.make();
    const id = made.body.orderId,
      p = [...f.payments.values()][0];
    const body = { id: 'evt_payment', event: 'PAYMENT_RECEIVED', payment: { ...p } };
    assert.equal(await f.webhook(body, ''), 401);
    p.value = 1;
    assert.equal((await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).status, 409);
    p.value = 192.06;
    p.customer = 'other';
    assert.equal((await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).status, 409);
    p.customer = 'cus_fixture';
    p.externalReference = 'other';
    assert.equal((await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).status, 409);
    p.externalReference = id;
    p.status = 'RECEIVED';
    assert.equal(await f.webhook(body), 200);
    assert.equal(await f.webhook(body), 200);
    await f.flush();
    assert.equal((await f.customer.call('/api/v1/orders/' + id)).body.order.paymentState, 'paid');
    assert.equal(
      (
        await f.app.db
          .prepare("SELECT COUNT(*) n FROM commerce_events WHERE id='evt_payment'")
          .first()
      ).n,
      1,
    );
    p.status = 'PENDING';
    assert.equal(
      (await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).body.paymentState,
      'paid',
    );
    p.status = 'REFUNDED';
    assert.equal(
      (await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).body.paymentState,
      'refund',
    );
    assert.equal((await f.admin.call(`/api/v1/orders/${id}/shipment`, {})).status, 409);
  } finally {
    await f.app.dispose();
  }
});

test('commerce: signed shipping events reject tampering and unrelated labels, deduplicate and preserve delivery order', async () => {
  const f = await fixture();
  try {
    const made = await f.make(),
      id = made.body.orderId;
    const sid = randomUUID();
    await f.app.db
      .prepare(
        "INSERT INTO shipments(id,order_id,sequence,state,provider_id,payload_json,updated_at) VALUES (?,?,1,'generated','label_signed','{}',0)",
      )
      .bind(sid, id)
      .run();
    const send = async (event, signature) => {
      const raw = JSON.stringify(event),
        r = await f.app.runtime.dispatchFetch(origin + '/api/v1/webhooks/melhorenvio', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-ME-Signature':
              signature ??
              createHmac('sha256', 'fixture-shipping-client-secret').update(raw).digest('base64'),
          },
          body: raw,
        });
      return r.status;
    };
    const data = {
      event: 'order.posted',
      data: {
        id: 'label_signed',
        status: 'posted',
        posted_at: '2026-11-14T12:00:00Z',
        tracking: null,
      },
    };
    assert.equal(await send(data, 'wrong'), 401);
    assert.equal(await send({ ...data, data: { ...data.data, id: 'other' } }), 404);
    assert.equal(await send(data), 200);
    assert.equal(await send(data), 200);
    await f.flush();
    assert.equal((await f.customer.call('/api/v1/orders/' + id)).body.shipments[0].state, 'posted');
    assert.equal(
      await send({
        event: 'order.generated',
        data: { id: 'label_signed', status: 'generated', generated_at: '2026-11-14T11:00:00Z' },
      }),
      200,
    );
    await f.flush();
    assert.equal((await f.customer.call('/api/v1/orders/' + id)).body.shipments[0].state, 'posted');
    assert.equal(
      (
        await f.app.db
          .prepare("SELECT COUNT(*) n FROM commerce_events WHERE provider='shipping'")
          .first()
      ).n,
      2,
    );
  } finally {
    await f.app.dispose();
  }
});

for (const status of [
  'PENDING',
  'OVERDUE',
  'CANCELLED',
  'REFUSED',
  'REFUNDED',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
])
  test(`commerce: ${status} never releases shipment`, async () => {
    const f = await fixture();
    try {
      const made = await f.make(),
        id = made.body.orderId;
      [...f.payments.values()][0].status = status;
      assert.equal((await f.admin.call(`/api/v1/orders/${id}/shipment`, {})).status, 409);
      assert.equal(f.app.calls.filter((c) => c.path === '/api/v2/me/cart').length, 0);
    } finally {
      await f.app.dispose();
    }
  });

test('commerce: installment group must have unique owned payments matching full amount before approval; partial refund blocks', async () => {
  const f = await fixture();
  try {
    const made = await f.make(),
      id = made.body.orderId,
      p = [...f.payments.values()][0];
    await f.app.db
      .prepare(
        "UPDATE orders SET installments=3,billing_type='CREDIT_CARD',installment_id='inst_test' WHERE id=?",
      )
      .bind(id)
      .run();
    const parts = [0, 1, 2].map((i) => ({
      ...p,
      id: i === 0 ? p.id : 'pay_part_' + i,
      value: 64.02,
      status: 'CONFIRMED',
      installment: 'inst_test',
    }));
    f.override((call) =>
      call.path === '/v3/installments/inst_test/payments'
        ? Response.json({ data: parts, hasMore: false })
        : undefined,
    );
    assert.equal(
      (await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).body.paymentState,
      'paid',
    );
    parts[2].installment = 'wrong';
    assert.equal((await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).status, 409);
    parts[2].installment = 'inst_test';
    parts[2].refundedValue = 1;
    assert.equal(
      (await f.customer.call(`/api/v1/orders/${id}/reconcile`, {})).body.paymentState,
      'refund',
    );
  } finally {
    await f.app.dispose();
  }
});

test('commerce: purchase timeout is held, reconciled, and never blindly retried; explicit failure can retry after read', async () => {
  const f = await fixture();
  try {
    const made = await f.make(),
      id = made.body.orderId;
    [...f.payments.values()][0].status = 'RECEIVED';
    await f.admin.call('/api/v1/orders/shipping-settings', sender);
    await f.admin.call(`/api/v1/orders/${id}/fiscal`, { key: '1'.repeat(44) });
    const prepared = await f.admin.call(`/api/v1/orders/${id}/shipment`, {}),
      sid = prepared.body.shipment.id;
    const act = (action) => f.admin.call(`/api/v1/orders/${id}/shipment/${sid}/${action}`, {});
    await act('cart');
    let calls = 0;
    f.override((call) => {
      if (call.path === '/api/v2/me/shipment/checkout') {
        calls++;
        [...f.labels.values()][0].status = 'released';
        return new Response('unknown', { status: 500 });
      }
    });
    assert.equal((await act('purchase')).status, 409);
    assert.equal((await act('purchase')).status, 409);
    assert.equal(calls, 1);
    assert.equal((await act('reconcile')).body.shipment.state, 'released');
    assert.equal((await act('purchase')).status, 200);
    assert.equal(calls, 1);
    // Generation explicitly rejected; a fresh provider read unlocks a corrected attempt.
    f.override((call) =>
      call.path === '/api/v2/me/shipment/generate'
        ? Response.json({ error: 'carrier unavailable' }, { status: 422 })
        : undefined,
    );
    assert.equal((await act('generate')).status, 409);
    await act('reconcile');
    f.override(() => undefined);
    assert.equal((await act('generate')).body.shipment.state, 'generated');
  } finally {
    await f.app.dispose();
  }
});

test('commerce: insufficient balance is retryable after reconciliation and cancelled labels keep replacement history', async () => {
  const f = await fixture();
  try {
    const made = await f.make(),
      id = made.body.orderId;
    [...f.payments.values()][0].status = 'RECEIVED';
    await f.admin.call('/api/v1/orders/shipping-settings', sender);
    await f.admin.call(`/api/v1/orders/${id}/fiscal`, { key: '1'.repeat(44) });
    const prepared = await f.admin.call(`/api/v1/orders/${id}/shipment`, {}),
      sid = prepared.body.shipment.id;
    const act = (action) => f.admin.call(`/api/v1/orders/${id}/shipment/${sid}/${action}`, {});
    await act('cart');
    f.override((call) =>
      call.path === '/api/v2/me/shipment/checkout'
        ? Response.json({ error: 'insufficient balance' }, { status: 422 })
        : undefined,
    );
    assert.equal((await act('purchase')).status, 409);
    await act('reconcile');
    f.override(() => undefined);
    assert.equal((await act('purchase')).body.shipment.state, 'released');
    assert.equal((await act('cancel')).body.shipment.state, 'cancelled');
    const replacement = await f.admin.call(`/api/v1/orders/${id}/shipment`, {});
    assert.equal(replacement.body.shipment.sequence, 2);
    assert.notEqual(replacement.body.shipment.id, sid);
    assert.equal((await f.customer.call('/api/v1/orders/' + id)).body.shipments.length, 2);
  } finally {
    await f.app.dispose();
  }
});

test('commerce: database failure rejects webhook and pending local email retries without duplicate delivery', async () => {
  const f = await fixture();
  try {
    await f.app.db.prepare('ALTER TABLE commerce_events RENAME TO unavailable_events').run();
    assert.equal(
      await f.webhook({
        id: 'evt_db_failure',
        event: 'PAYMENT_CREATED',
        payment: { id: 'pay_db' },
      }),
      500,
    );
    assert.equal(
      (
        await f.app.db
          .prepare("SELECT COUNT(*) n FROM sandbox_asaas_events WHERE id='evt_db_failure'")
          .first()
      ).n,
      0,
    );
    await f.app.db.prepare('ALTER TABLE unavailable_events RENAME TO commerce_events').run();
    assert.equal(
      await f.webhook({
        id: 'evt_db_failure',
        event: 'PAYMENT_CREATED',
        payment: { id: 'pay_db' },
      }),
      200,
    );
    await f.flush();
    const made = await f.make(),
      id = made.body.orderId;
    await f.app.db
      .prepare("UPDATE order_notifications SET state='pending' WHERE order_id=?")
      .bind(id)
      .run();
    await f.admin.call('/api/v1/orders/mail');
    await f.admin.call('/api/v1/orders/mail');
    assert.equal(
      (
        await f.app.db
          .prepare(
            'SELECT COUNT(*) n FROM local_order_mail WHERE id IN (SELECT id FROM order_notifications WHERE order_id=?)',
          )
          .bind(id)
          .first()
      ).n,
      1,
    );
    assert.equal(f.app.unexpected.length, 0);
  } finally {
    await f.app.dispose();
  }
});

test('commerce: delivery exceptions are visible only to owner and never imply delivered', async () => {
  const f = await fixture();
  try {
    const made = await f.make(),
      id = made.body.orderId,
      sid = randomUUID();
    await f.app.db
      .prepare(
        "INSERT INTO shipments(id,order_id,sequence,state,provider_id,payload_json,updated_at) VALUES (?,?,1,'posted','label_exception','{}',0)",
      )
      .bind(sid, id)
      .run();
    f.labels.set('label_exception', {
      id: 'label_exception',
      status: 'undelivered',
      tracking: null,
    });
    const r = await f.admin.call(`/api/v1/orders/${id}/shipment/${sid}/reconcile`, {});
    assert.equal(r.body.shipment.state, 'undelivered');
    assert.equal(
      (await f.customer.call('/api/v1/orders/' + id)).body.shipments[0].state,
      'undelivered',
    );
    assert.equal((await (await f.app.client()).call('/api/v1/orders/' + id)).status, 404);
  } finally {
    await f.app.dispose();
  }
});
