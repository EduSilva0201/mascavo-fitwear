import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, quote } from '../support/worker.mjs';
const bindings = {
  MELHOR_ENVIO_CLIENT_ID: '123',
  MELHOR_ENVIO_REFRESH_TOKEN: 'fixture-refresh',
  MELHOR_ENVIO_TOKEN_EXPIRES_AT: '1',
};
test('shipping OAuth refresh rotates tokens once and persists server-side for later quotes', async () => {
  const app = await createWorker({ bindings });
  try {
    let refreshes = 0;
    app.mock((call) => {
      if (call.path === '/oauth/token') {
        refreshes++;
        return Response.json({
          access_token: 'fixture-rotated',
          refresh_token: 'fixture-next-refresh',
          expires_in: 3600,
        });
      }
    });
    const c = await app.client();
    assert.equal((await quote(c)).status, 200);
    assert.equal((await quote(c)).status, 200);
    assert.equal(refreshes, 1);
    const row = await app.db
      .prepare("SELECT * FROM integration_tokens WHERE provider='shipping'")
      .first();
    assert.equal(row.access_token, 'fixture-rotated');
    assert.equal(row.refresh_token, 'fixture-next-refresh');
  } finally {
    await app.dispose();
  }
});
test('ambiguous OAuth refresh is not blindly repeated and exposes no credentials', async () => {
  const app = await createWorker({ bindings });
  try {
    let refreshes = 0;
    app.mock((call) => {
      if (call.path === '/oauth/token') {
        refreshes++;
        return new Response('secret response', { status: 500 });
      }
    });
    const c = await app.client();
    const first = await quote(c),
      second = await quote(c);
    assert.equal(first.status, 503);
    assert.equal(second.status, 503);
    assert.equal(refreshes, 1);
    assert.equal(JSON.stringify(first.body).includes('fixture-refresh'), false);
  } finally {
    await app.dispose();
  }
});
