import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createWorker } from '../support/worker.mjs';

const origin = 'https://teste.example.test';
const credentials = { STAGING_USERNAME: 'tester', STAGING_PASSWORD: 'fixture-password-with-at-least-24-chars' };
const authorization = 'Basic ' + Buffer.from(`${credentials.STAGING_USERNAME}:${credentials.STAGING_PASSWORD}`).toString('base64');

test('staging: Melhor Envio exchanges a browser-bound authorization once and saves it in D1', async () => {
  const app = await createWorker({
    bindings: { APP_ENV: 'staging', APP_ORIGIN: origin, MELHOR_ENVIO_CLIENT_ID: 'fixture-client', ...credentials },
  });
  try {
    const { id } = await app.client({ role: 'admin' });
    const session = randomBytes(32).toString('hex');
    const digest = createHash('sha256').update(session).digest('hex');
    await app.db.prepare('UPDATE sessions SET token_hash=? WHERE customer_id=?').bind(digest, id).run();
    const sessionCookie = '__Host-mascavo-session=' + session;
    const path = '/integracoes/melhorenvio';
    const request = (path, options = {}, cookie = sessionCookie) => app.runtime.dispatchFetch(origin + path, {
      ...options, redirect: 'manual', headers: { authorization, cookie, origin },
    });
    app.mock(call => call.path === '/oauth/token' ? Response.json({
      access_token: 'fixture-new-access', refresh_token: 'fixture-new-refresh', expires_in: 3600,
    }) : undefined);

    const page = await request(path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    assert.equal((await request(path, { method: 'POST' }, '')).status, 401);
    const start = await request(path, { method: 'POST' });
    assert.equal(start.status, 303);
    const provider = new URL(start.headers.get('location'));
    assert.equal(provider.origin, 'https://sandbox.melhorenvio.com.br');
    assert.equal(provider.searchParams.get('redirect_uri'), origin + path + '/callback');
    const state = provider.searchParams.get('state');
    const callback = path + '/callback?code=fixture-code&state=' + state;
    const oauthCookie = start.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(callback)).status, 400);
    const accepted = await request(callback, {}, oauthCookie);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await request(callback, {}, oauthCookie)).status, 400);
    assert.equal(app.calls.filter(call => call.path === '/oauth/token').length, 1);
    const token = await app.db.prepare("SELECT access_token FROM integration_tokens WHERE provider='shipping'").first();
    assert.equal(token.access_token, 'fixture-new-access');
  } finally { await app.dispose(); }
});

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
    assert.deepEqual(await accepted.json(), { status: 'ok', environment: 'staging', checkout: 'sandbox', production: false, integratedShipping: true });
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

test('staging: browser form authenticates the storefront and API with a signed cookie', async () => {
  const app = await createWorker({ bindings: { APP_ENV: 'staging', APP_ORIGIN: origin, ...credentials } });
  try {
    const request = (path, options = {}) => app.runtime.dispatchFetch(origin + path, options);
    const gate = await request('/', { headers: { accept: 'text/html' } });
    assert.equal(gate.status, 401);
    assert.equal(gate.headers.get('www-authenticate'), null);
    assert.match(await gate.text(), /Entrar na loja/);
    const submit = (password, formOrigin = origin) => request('/acesso-homologacao', {
      method: 'POST', redirect: 'manual', headers: { origin: formOrigin },
      body: new URLSearchParams({ username: credentials.STAGING_USERNAME, password }),
    });
    assert.equal((await submit(credentials.STAGING_PASSWORD, 'https://other.example.test')).status, 403);
    const denied = await submit('wrong');
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('set-cookie'), null);
    const accepted = await submit(credentials.STAGING_PASSWORD);
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/');
    const cookie = accepted.headers.get('set-cookie');
    assert.match(cookie, /^__Host-mascavo-staging=/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    const value = cookie.split(';')[0];
    assert.equal((await request('/api/v1/health', { headers: { cookie: value } })).status, 200);
    assert.equal((await request('/api/v1/health', { headers: { cookie: value + 'tamper' } })).status, 401);
  } finally { await app.dispose(); }
});

test('staging: missing password fails closed and production checkout defaults to closed', async () => {
  for (const environment of ['staging', 'production']) {
    const app = await createWorker({ bindings: { APP_ENV: environment, APP_ORIGIN: origin } });
    try {
      const response = await app.runtime.dispatchFetch(origin + '/api/v1/health');
      if (environment === 'staging') {
        assert.equal(response.status, 503);
      } else {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).checkout, 'closed');
        assert.match(response.headers.get('x-robots-tag'), /noindex/);
        assert.equal((await app.runtime.dispatchFetch('http://teste.example.test/api/v1/health')).status, 503);
      }
    } finally { await app.dispose(); }
  }
});

test('production webhook responds on the store domain and requires authentication for events', async () => {
  const app = await createWorker({ bindings: { APP_ENV: 'production', APP_ORIGIN: origin } });
  try {
    const path = '/api/v1/webhooks/asaas';
    const get = await app.runtime.dispatchFetch(origin + path);
    assert.equal(get.status, 200);
    assert.match(get.headers.get('x-robots-tag'), /noindex/);
    assert.equal((await app.runtime.dispatchFetch('https://webhooks.example.test' + path)).status, 503);
    const post = (token) => app.runtime.dispatchFetch(origin + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': token }, body: '{}',
    });
    assert.equal((await post('invalid')).status, 401);
    assert.equal((await post('fixture-webhook-token-with-at-least-32-characters')).status, 400);
  } finally {
    await app.dispose();
  }
});
