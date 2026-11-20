import { test } from 'node:test';
import assert from 'node:assert/strict';
// No dotenv import: the regular local credentials file is deliberately not read.
if (process.env.RUN_SANDBOX_TESTS !== '1') throw Error('Explicit RUN_SANDBOX_TESTS=1 is required.');
const selected = process.env.SANDBOX_PROVIDER || 'both';
if (!['asaas', 'melhorenvio', 'both'].includes(selected)) throw Error('Invalid SANDBOX_PROVIDER');
let requests = 0;
async function request(provider, path, options = {}) {
  const hosts = {
    asaas: 'https://api-sandbox.asaas.com',
    melhorenvio: 'https://sandbox.melhorenvio.com.br',
  };
  const allowed = {
    asaas: ['/v3/payments?limit=1'],
    melhorenvio: ['/api/v2/me/shipment/calculate'],
  };
  assert.ok(allowed[provider].includes(path), 'Only allowlisted read/quote operations are allowed');
  assert.ok(++requests <= 2, 'Sandbox request budget exceeded');
  const key =
    provider === 'asaas'
      ? process.env.ASAAS_SANDBOX_API_KEY
      : process.env.MELHOR_ENVIO_SANDBOX_TOKEN;
  assert.ok(key, 'Required sandbox credential is missing');
  if (provider === 'asaas')
    assert.ok(key.startsWith('$aact_hmlg_'), 'Expected an Asaas sandbox key');
  let response;
  try {
    response = await fetch(hosts[provider] + path, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mascavo Sandbox Tests (test@example.test)',
        ...(provider === 'asaas' ? { access_token: key } : { Authorization: 'Bearer ' + key }),
      },
    });
  } catch {
    assert.fail('Sandbox connection failed or timed out; credentials and response body omitted');
  }
  assert.equal(response.status, 200, 'Sandbox returned HTTP ' + response.status);
  try {
    return await response.json();
  } catch {
    assert.fail('Sandbox returned invalid JSON; response body omitted');
  }
}
test(
  'sandbox Asaas: authenticated read only; no charges created',
  { skip: selected === 'melhorenvio' },
  async () => {
    const data = await request('asaas', '/v3/payments?limit=1');
    assert.ok(Array.isArray(data.data), 'Expected a payment list; content omitted');
  },
);
test(
  'sandbox Melhor Envio: quote only; no labels purchased',
  { skip: selected === 'asaas' },
  async () => {
    const data = await request('melhorenvio', '/api/v2/me/shipment/calculate', {
      method: 'POST',
      body: JSON.stringify({
        from: { postal_code: '73060604' },
        to: { postal_code: '01001000' },
        products: [
          {
            id: 'fixture',
            width: 20,
            height: 4,
            length: 25,
            weight: 0.3,
            insurance_value: 1,
            quantity: 1,
          },
        ],
        options: { receipt: false, own_hand: false },
        services: '1,2',
      }),
    });
    assert.ok(Array.isArray(data), 'Expected a quote list; content omitted');
    assert.ok(
      data.some((r) => !r.error && Number(r.price ?? r.custom_price) > 0),
      'No available quote returned',
    );
  },
);
