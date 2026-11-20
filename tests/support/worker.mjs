import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const origin = 'http://127.0.0.1:8799';
export const cart = [{ id: 14, color: 'Preto', size: 'M', qty: 1 }];
export const defaultRates = [
  { id: 1, name: 'PAC', company: { id: 1, name: 'Correios' }, price: '22.06', delivery_time: 5 },
  {
    id: 2,
    name: 'SEDEX',
    company: { id: 1, name: 'Correios' },
    custom_price: '41.83',
    custom_delivery_time: 2,
  },
];
let bundle;
export async function createWorker({ bindings = {} } = {}) {
  bundle ??= build({
    entryPoints: ['backend/src/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  }).then((r) => r.outputFiles[0].text);
  const calls = [],
    unexpected = [];
  let handler = () => undefined;
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await bundle,
      compatibilityDate: '2026-11-09',
      d1Databases: ['DB'],
      d1Persist: false,
      r2Buckets: ['IMAGES'],
      r2Persist: false,
      bindings: {
        APP_ENV: 'local',
        APP_ORIGIN: origin,
        ASAAS_API_KEY: 'fixture-asaas-not-a-real-key',
        ASAAS_WEBHOOK_TOKEN: 'fixture-webhook-token-with-at-least-32-characters',
        COMMERCE_MAINTENANCE_TOKEN: 'fixture-maintenance-token-at-least-32-characters',
        MELHOR_ENVIO_CLIENT_SECRET: 'fixture-shipping-client-secret',
        MELHOR_ENVIO_TOKEN: 'fixture-shipping-not-a-real-token',
        MELHOR_ENVIO_USER_AGENT: 'Mascavo Tests (test@example.test)',
        SHIPPING_ORIGIN_CEP: '73060604',
        SHIPPING_ITEM_WEIGHT_KG: '0.3',
        SHIPPING_ITEM_WIDTH_CM: '20',
        SHIPPING_ITEM_HEIGHT_CM: '4',
        SHIPPING_ITEM_LENGTH_CM: '25',
        ...bindings,
      },
      serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
      // Every outbound request is intercepted. No fetch fallback is permitted.
      outboundService: async (request) => {
        const url = new URL(request.url),
          body = await request.json().catch(() => null);
        const call = { host: url.hostname, path: url.pathname, method: request.method, body };
        calls.push(call);
        if (!['api-sandbox.asaas.com', 'sandbox.melhorenvio.com.br'].includes(url.hostname)) {
          unexpected.push(call.host);
          return Response.json({ error: 'Network blocked by tests' }, { status: 599 });
        }
        const override = await handler(call);
        if (override !== undefined) return override;
        if (url.pathname === '/api/v2/me/shipment/calculate') return Response.json(defaultRates);
        if (url.pathname === '/v3/customers') return Response.json({ id: 'cus_fixture' });
        if (url.pathname === '/v3/payments')
          return Response.json({
            id: 'pay_fixture',
            invoiceUrl: 'https://sandbox.asaas.com/i/fixture',
          });
        unexpected.push(call.path);
        return Response.json({ error: 'Unmocked endpoint' }, { status: 599 });
      },
    }),
  );
  try {
    const db = await runtime.getD1Database('DB');
    for (const name of (await readdir('backend/migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const sql = (await readFile('backend/migrations/' + name, 'utf8')).replace(/^\s*--.*$/gm, '');
      // Current migrations contain no triggers or embedded semicolons in strings.
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^--[^\n]*$/.test(s));
      for (const statement of statements) await db.prepare(statement).run();
    }
    async function client({ role = 'customer', profile = true } = {}) {
      const id = randomUUID(),
        session = randomBytes(32).toString('hex'),
        csrf = randomBytes(32).toString('hex');
      const time = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          'INSERT INTO customers(id,name,email,password_hash,role,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          'Cliente Ficticio',
          id + '@example.test',
          'not-a-login-password',
          role,
          time,
          time,
          time,
        )
        .run();
      await db
        .prepare(
          'INSERT INTO sessions(token_hash,customer_id,created_at,last_seen_at,expires_at,idle_expires_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(
          createHash('sha256').update(session).digest('hex'),
          id,
          time,
          time,
          time + 3600,
          time + 3600,
        )
        .run();
      if (profile)
        await db
          .prepare('INSERT INTO customer_profiles VALUES (?,?,?,?)')
          .bind(id, '52998224725', '', time)
          .run();
      return {
        id,
        csrf,
        async call(path, data, headers = {}) {
          const response = await runtime.dispatchFetch(origin + path, {
            method: data === undefined ? 'GET' : 'POST',
            headers: {
              Cookie: `mascavo-session-local=${session}; mascavo-csrf-local=${csrf}`,
              Origin: origin,
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
              ...headers,
            },
            body: data === undefined ? undefined : JSON.stringify(data),
            redirect: 'manual',
          });
          return { status: response.status, body: await response.json() };
        },
      };
    }
    return {
      runtime,
      db,
      calls,
      unexpected,
      client,
      mock(fn) {
        handler = fn;
      },
      reset() {
        calls.length = 0;
        unexpected.length = 0;
        handler = () => undefined;
      },
      async dispose() {
        await runtime.dispose();
      },
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
export async function quote(client, items = cart) {
  return client.call('/api/v1/integrations/shipping/quote', { items, cep: '04794000' });
}
export function payment(quoteId, overrides = {}) {
  return {
    items: cart,
    quoteId,
    serviceId: '1',
    billingType: 'PIX',
    installments: 1,
    requestKey: randomUUID(),
    ...overrides,
  };
}
