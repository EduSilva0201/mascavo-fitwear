import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerRequest, shippingDimensions } from '../backend/src/modules/integrations/providers.ts';
import { paymentChoiceSchema, paymentAmount, cartSnapshot } from '../backend/src/modules/integrations/checkout.ts';

test('checkout limits credit to three installments and other methods to one', () => {
  for (const installments of [1,2,3]) assert.equal(paymentChoiceSchema.safeParse({ billingType: 'CREDIT_CARD', installments }).success,true);
  for (const installments of [0,4,12,1.5]) assert.equal(paymentChoiceSchema.safeParse({ billingType: 'CREDIT_CARD', installments }).success,false);
  for (const billingType of ['PIX','BOLETO']) {
    assert.equal(paymentChoiceSchema.safeParse({ billingType, installments: 1 }).success,true);
    assert.equal(paymentChoiceSchema.safeParse({ billingType, installments: 2 }).success,false);
  }
  assert.deepEqual(paymentAmount(19206,3),{ installmentCount: 3, totalValue: 192.06 });
  assert.deepEqual(paymentAmount(19206,1),{ value: 192.06 });
});
test('shipping snapshot changes when price, variant or quantity changes', () => {
  const item = { id: 14, color: 'Preto', size: 'M', qty: 1, priceCents: 17000 };
  for (const patch of [{ qty: 2 },{ priceCents: 18000 },{ color: 'Vinho' }]) assert.notEqual(cartSnapshot([item]),cartSnapshot([{...item,...patch}]));
});

test('missing credentials and shipping configuration fail before sending requests', async () => {
  await assert.rejects(providerRequest({}, 'asaas', '/payments', {}), e => e.status === 503);
  await assert.rejects(providerRequest({ MELHOR_ENVIO_TOKEN: 'test' }, 'shipping', '/me/shipment/calculate', {}), e => e.status === 503);
  assert.throws(() => shippingDimensions({}), e => e.status === 503);
  assert.throws(() => shippingDimensions({ SHIPPING_ORIGIN_CEP: '01001000', SHIPPING_ITEM_WEIGHT_KG: '-1' }), e => e.status === 503);
});
test('provider requests use fixed sandbox hosts, server credentials and no redirects', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ id: 'test' });
  });
  await providerRequest({ ASAAS_API_KEY: 'secret' }, 'asaas', '/payments', { value: 10 });
  await providerRequest({ MELHOR_ENVIO_TOKEN: 'shipping-secret', MELHOR_ENVIO_USER_AGENT: 'Mascavo (test@example.test)' }, 'shipping', '/me/shipment/calculate', {});
  assert.equal(calls[0].url, 'https://api-sandbox.asaas.com/v3/payments');
  assert.equal(calls[0].headers.access_token, 'secret');
  assert.equal(calls[0].redirect, 'manual');
  assert.deepEqual(JSON.parse(calls[0].body), { value: 10 });
  assert.equal(calls[1].url, 'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
  assert.equal(calls[1].headers.Authorization, 'Bearer shipping-secret');
  assert.equal(calls[1].redirect, 'manual');
});
test('redirects are rejected and shipping connection errors do not mention payments', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://example.test' } });
  });
  await assert.rejects(providerRequest({ ASAAS_API_KEY: 'secret' }, 'asaas', '/payments', {}), e => e.status === 502 && e.message.includes('302'));
  assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network'); });
  await assert.rejects(providerRequest({ MELHOR_ENVIO_TOKEN: 'secret', MELHOR_ENVIO_USER_AGENT: 'Mascavo' }, 'shipping', '/me/shipment/calculate', {}), e => e.message.includes('Melhor Envio') && !e.message.includes('Asaas'));
});
test('provider errors hide response bodies and ambiguous writes are never retried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('sensitive internal detail'); });
  await assert.rejects(providerRequest({ ASAAS_API_KEY: 'secret' }, 'asaas', '/payments', {}), e => e.status === 502 && !e.message.includes('sensitive'));
  assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => new Response('sensitive provider data', { status: 401 }));
  await assert.rejects(providerRequest({ ASAAS_API_KEY: 'secret' }, 'asaas', '/payments', {}), e => e.message.includes('401') && !e.message.includes('sensitive'));
});
