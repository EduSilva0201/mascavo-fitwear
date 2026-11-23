import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { equal } from '../auth/crypto';
import { digest } from '../auth/crypto';
import { processEvents, maintenance } from '../orders/events';

const webhooks = new Hono<{ Bindings: Env }>();
const eventSchema = z
  .object({
    id: z.string().min(1).max(255),
    event: z
      .string()
      .regex(/^PAYMENT_[A-Z_]+$/)
      .max(100),
    payment: z.object({ id: z.string().min(1).max(255) }).passthrough(),
  })
  .passthrough();

webhooks.get('/asaas', (c) => c.json({ status: 'ok' }));
webhooks.post('/asaas', async (c) => {
  const token = c.env.ASAAS_WEBHOOK_TOKEN;
  if (!token || token.length < 32) return c.json({ error: 'Webhook indisponivel.' }, 503);
  if (!equal(token, c.req.header('asaas-access-token') || ''))
    return c.json({ error: 'Token invalido.' }, 401);
  if (!c.req.header('Content-Type')?.startsWith('application/json'))
    return c.json({ error: 'Envie JSON.' }, 415);
  const parsed = eventSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Evento de pagamento invalido.' }, 400);
  // Receipt only: payment reconciliation and order fulfilment are separate milestones.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO sandbox_asaas_events
    (id,event,payment_id,payload_json,received_at) VALUES (?,?,?,?,?)`,
    ).bind(
      parsed.data.id,
      parsed.data.event,
      parsed.data.payment.id,
      JSON.stringify(parsed.data),
      Math.floor(Date.now() / 1000),
    ),
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO commerce_events(provider,id,resource_id,payload_json,received_at) VALUES (?,?,?,?,?)',
    ).bind(
      'asaas',
      parsed.data.id,
      parsed.data.payment.id,
      JSON.stringify(parsed.data),
      Math.floor(Date.now() / 1000),
    ),
  ]);
  c.executionCtx.waitUntil(
    processEvents(c.env).catch(() => console.error('commerce_processing_failed')),
  );
  return c.json({ received: true });
});
webhooks.post('/melhorenvio', async (c) => {
  const secret = c.env.MELHOR_ENVIO_CLIENT_SECRET;
  if (!secret) return c.json({ error: 'Configure o segredo do aplicativo Melhor Envio.' }, 503);
  if (!c.req.header('Content-Type')?.startsWith('application/json'))
    return c.json({ error: 'Envie JSON.' }, 415);
  const raw = await c.req.text();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)),
  );
  const expected = btoa(String.fromCharCode(...signature));
  if (!equal(expected, c.req.header('X-ME-Signature') || ''))
    return c.json({ error: 'Assinatura invalida.' }, 401);
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    envelope = null;
  }
  const parsed = z
    .object({
      event: z.string().regex(/^order\.[a-z-]+$/),
      data: z
        .object({ id: z.string().min(1).max(255), status: z.string().min(1).max(50) })
        .passthrough(),
    })
    .passthrough()
    .safeParse(envelope);
  if (!parsed.success) {
    // Registration probes and future envelope formats are not shipment updates.
    // Keep the authenticated payload for inspection without changing any order.
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO commerce_events(provider,id,resource_id,payload_json,state,received_at) VALUES (?,?,?,?,'review',?)",
    ).bind('shipping', await digest(raw), 'unrecognized', raw, Math.floor(Date.now() / 1000)).run();
    return c.json({ received: true, processing: 'review' });
  }
  if (
    !(await c.env.DB.prepare('SELECT id FROM shipments WHERE provider_id=?')
      .bind(parsed.data.data.id)
      .first())
  )
    return c.json({ error: 'Etiqueta nao vinculada a loja.' }, 404);
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO commerce_events(provider,id,resource_id,payload_json,received_at) VALUES (?,?,?,?,?)',
  )
    .bind('shipping', await digest(raw), parsed.data.data.id, raw, Math.floor(Date.now() / 1000))
    .run();
  c.executionCtx.waitUntil(
    processEvents(c.env).catch(() => console.error('commerce_processing_failed')),
  );
  return c.json({ received: true });
});
webhooks.post('/process', async (c) => {
  const token = c.env.COMMERCE_MAINTENANCE_TOKEN;
  if (!token || token.length < 32 || !equal(token, c.req.header('X-Maintenance-Token') || ''))
    return c.json({ error: 'Acesso restrito.' }, 401);
  return c.json(await maintenance(c.env));
});
export default webhooks;
