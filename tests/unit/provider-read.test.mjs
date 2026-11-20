import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerRequest } from '../../backend/src/modules/integrations/providers.ts';
test('provider reads use GET without body and never follow redirects', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api-sandbox.asaas.com/v3/payments/pay_test');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'manual');
    return Response.json({ id: 'pay_test' });
  });
  assert.equal(
    (
      await providerRequest(
        { ASAAS_API_KEY: 'fixture' },
        'asaas',
        '/payments/pay_test',
        null,
        'GET',
      )
    ).id,
    'pay_test',
  );
});
