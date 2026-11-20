import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, callback, callbackPath, config } from '../../scripts/melhorenvio-oauth.mjs';

test('Melhor Envio callback is informative before authorization and rejects unsolicited codes', async () => {
  assert.equal((await callback(new URL('https://example.test' + callbackPath)))[0], 200);
  assert.equal((await callback(new URL('https://example.test' + callbackPath + '?code=unexpected')))[0], 400);
});

test('OAuth binds state, expires, exchanges once, and stores secrets only locally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mascavo-oauth-'));
  const envPath = join(dir, '.dev.vars'), pendingPath = join(dir, 'state.json');
  const options = { envPath, pendingPath };
  try {
    await writeFile(envPath, 'ASAAS_WEBHOOK_TOKEN=keep-existing-secret\nMELHOR_ENVIO_CLIENT_ID=123\nMELHOR_ENVIO_CLIENT_SECRET=test-secret\nMELHOR_ENVIO_USER_AGENT="Mascavo Tests (test@example.test)"\nMELHOR_ENVIO_REDIRECT_URI=https://example.test' + callbackPath + '\n');
    let auth = new URL(await authorize(options));
    assert.equal(auth.origin, 'https://sandbox.melhorenvio.com.br');
    assert.equal(auth.searchParams.get('scope').includes('shipping-calculate'), true);
    assert.equal(auth.searchParams.get('scope').includes('shipping-checkout'), true);
    assert.equal(auth.searchParams.has('client_secret'), false);
    const callbackUrl = new URL('https://example.test' + callbackPath);
    callbackUrl.search = new URLSearchParams({ code: 'code-test', state: 'a'.repeat(64) });
    let calls = 0;
    const request = async (url, init) => {
      calls++;
      assert.equal(url, 'https://sandbox.melhorenvio.com.br/oauth/token');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body.get('client_secret'), 'test-secret');
      assert.equal(init.body.get('code'), 'code-test');
      assert.equal(init.body.get('redirect_uri'), 'https://example.test' + callbackPath);
      return Response.json({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600 });
    };
    assert.equal((await callback(callbackUrl, { ...options, request }))[0], 400);
    assert.equal(calls, 0);
    const pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    await writeFile(pendingPath, JSON.stringify({ ...pending, expiresAt: 1 }));
    callbackUrl.searchParams.set('state', auth.searchParams.get('state'));
    assert.equal((await callback(callbackUrl, { ...options, request }))[0], 400);
    auth = new URL(await authorize(options));
    callbackUrl.searchParams.set('state', auth.searchParams.get('state'));
    const result = await callback(callbackUrl, { ...options, request });
    assert.equal(result[0], 200);
    assert.equal(result[1].includes('access-test'), false);
    assert.equal(result[1].includes('refresh-test'), false);
    const saved = await config(envPath);
    assert.equal(saved.MELHOR_ENVIO_TOKEN, 'access-test');
    assert.equal(saved.MELHOR_ENVIO_REFRESH_TOKEN, 'refresh-test');
    assert.equal(saved.ASAAS_WEBHOOK_TOKEN, 'keep-existing-secret');
    assert.equal((await callback(callbackUrl, { ...options, request }))[0], 400);
    assert.equal(calls, 1);
    auth = new URL(await authorize(options));
    callbackUrl.searchParams.set('state', auth.searchParams.get('state'));
    assert.equal((await callback(callbackUrl, { ...options, request: async () => new Response('failed', { status: 401 }) }))[0], 502);
    assert.equal((await callback(callbackUrl, { ...options, request }))[0], 400);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
