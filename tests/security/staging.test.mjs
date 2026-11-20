import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../support/worker.mjs';

const origin = 'https://teste.example.test';
const credentials = { STAGING_USERNAME: 'tester', STAGING_PASSWORD: 'fixture-password-with-at-least-24-chars' };
const authorization = 'Basic ' + Buffer.from(`${credentials.STAGING_USERNAME}:${credentials.STAGING_PASSWORD}`).toString('base64');

test('staging: HTTPS origin, private gate, no indexing and development mailbox disabled', async () => {
  const app = await createWorker({ bindings: { APP_ENV: 'staging', APP_ORIGIN: origin, ...credentials } });
  try {
    const request = (path, options = {}) => app.runtime.dispatchFetch(origin + path, options);
    const denied = await request('/api/v1/health');
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /^Basic /);
    assert.match(denied.headers.get('x-robots-tag'), /noindex/);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    const accepted = await request('/api/v1/health', { headers: { authorization } });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { status: 'ok', environment: 'staging', checkout: 'sandbox', production: false });
    const asset = await request('/styles.css', { headers: { authorization } });
    assert.match(asset.headers.get('x-robots-tag'), /noindex/);
    assert.equal(asset.headers.get('cache-control'), 'no-store');
    assert.equal((await request('/api/v1/integrations/status', { headers: { authorization } })).status, 401);
    assert.equal((await request('/api/v1/dev/mail', { headers: { authorization } })).status, 404);
    assert.equal((await app.runtime.dispatchFetch('http://teste.example.test/api/v1/health', { headers: { authorization } })).status, 503);
    assert.equal((await app.runtime.dispatchFetch('https://other.example.test/api/v1/health', { headers: { authorization } })).status, 503);
    for (const provider of ['asaas', 'melhorenvio']) {
      // Provider authentication is still enforced without the shared Basic password.
      assert.equal((await request('/api/v1/webhooks/' + provider, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
      assert.equal((await request('/api/v1/webhooks/' + provider)).status, 401);
    }
    assert.equal((await request('/api/v1/webhooks/process', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/v1/webhooks/asaas/extra', { method: 'POST' })).status, 401);
  } finally { await app.dispose(); }
});

test('staging: missing password fails closed and production remains disabled', async () => {
  for (const environment of ['staging', 'production']) {
    const app = await createWorker({ bindings: { APP_ENV: environment, APP_ORIGIN: origin } });
    try {
      assert.equal((await app.runtime.dispatchFetch(origin + '/api/v1/health')).status, 503);
    } finally { await app.dispose(); }
  }
});
