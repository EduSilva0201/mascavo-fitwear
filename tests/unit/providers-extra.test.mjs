import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  providerRequest,
  shippingDimensions,
} from '../../backend/src/modules/integrations/providers.ts';
import { cartSnapshot } from '../../backend/src/modules/integrations/checkout.ts';
const credentials = {
  ASAAS_API_KEY: 'fixture',
  MELHOR_ENVIO_TOKEN: 'fixture',
  MELHOR_ENVIO_USER_AGENT: 'Fixture (test@example.test)',
};
test('checkout: reordered cart retains the same quote fingerprint', () => {
  const a = { id: 14, color: 'Preto', size: 'M', qty: 1, priceCents: 17000 },
    b = { ...a, color: 'Vinho' };
  assert.equal(cartSnapshot([a, b]), cartSnapshot([b, a]));
});
for (const provider of ['asaas', 'shipping']) {
  test(`${provider}: actual AbortSignal expiry returns a sanitized timeout without retries`, async (t) => {
    const timeout = AbortSignal.timeout;
    let calls = 0;
    t.mock.method(AbortSignal, 'timeout', (ms) => {
      assert.equal(ms, 20000);
      return timeout(5);
    });
    t.mock.method(
      globalThis,
      'fetch',
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          calls++;
          const hold = setTimeout(() => reject(new Error('timer failed')), 1000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(hold);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    await assert.rejects(
      providerRequest(credentials, provider, '/fixture', {}),
      (e) => e.status === 502 && !e.message.includes('fixture'),
    );
    assert.equal(calls, 1);
  });
  test(`${provider}: invalid JSON and redirects never return a successful body`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('not-json'));
    await assert.rejects(
      providerRequest(credentials, provider, '/fixture', {}),
      (e) => e.status === 502,
    );
    t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(null, { status: 307, headers: { Location: 'https://attacker.test' } }),
    );
    await assert.rejects(
      providerRequest(credentials, provider, '/fixture', {}),
      (e) => e.status === 502,
    );
  });
}
test('melhorenvio: dimensions require positive finite numbers and eight-digit origin', () => {
  const env = {
    SHIPPING_ORIGIN_CEP: '73060604',
    SHIPPING_ITEM_WEIGHT_KG: '0.3',
    SHIPPING_ITEM_WIDTH_CM: '20',
    SHIPPING_ITEM_HEIGHT_CM: '4',
    SHIPPING_ITEM_LENGTH_CM: '25',
  };
  assert.deepEqual(shippingDimensions(env), { weight: 0.3, width: 20, height: 4, length: 25 });
  for (const key of [
    'SHIPPING_ITEM_WEIGHT_KG',
    'SHIPPING_ITEM_WIDTH_CM',
    'SHIPPING_ITEM_HEIGHT_CM',
    'SHIPPING_ITEM_LENGTH_CM',
  ])
    for (const value of ['0', '-1', 'NaN', 'Infinity', ''])
      assert.throws(
        () => shippingDimensions({ ...env, [key]: value }),
        (e) => e.status === 503,
      );
  assert.throws(
    () => shippingDimensions({ ...env, SHIPPING_ORIGIN_CEP: '73060-604' }),
    (e) => e.status === 503,
  );
});
