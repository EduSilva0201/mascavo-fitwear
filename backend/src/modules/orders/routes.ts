import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../../env';
import { currentSession, csrfCookie } from '../auth/session';
import { phoneSchema } from '../auth/profile';
import { equal } from '../auth/crypto';
import { IntegrationError } from '../integrations/providers';
import { orderMailEnabled } from './mail';
import { isProduction } from '../../commerce-environment';
import { isCheckoutPilot } from '../../checkout-pilot';
import {
  createOrder,
  orderSchema,
  getOrder,
  expireReservations,
  reconcilePayment,
  deliverLocalMail,
} from './service';
import {
  fiscalSchema,
  senderSchema,
  packageSchema,
  prepareShipment,
  getShipment,
  reconcileShipment,
  shippingAction,
} from './shipping';

const orders = new Hono<{ Bindings: Env }>();
orders.onError((error, c) => {
  if (error instanceof IntegrationError) return c.json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return c.json({ error: 'JSON invalido.' }, 400);
  console.error('commerce_failed', { name: error.name });
  return c.json({ error: 'Operacao nao concluida. Consulte o pedido antes de repetir.' }, 500);
});
orders.use('*', async (c, next) => {
  const session = await currentSession(c);
  if (!session) return c.json({ error: 'Entre para continuar.' }, 401);
  if (c.req.method !== 'GET') {
    const token = getCookie(c, csrfCookie(c)) || '';
    if (
      c.req.header('Origin') !== c.env.APP_ORIGIN ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !equal(token, c.req.header('X-CSRF-Token') || '')
    )
      return c.json({ error: 'Atualize a pagina e tente novamente.' }, 403);
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: 'Envie JSON.' }, 415);
  }
  await next();
});
async function admin(c: Parameters<typeof currentSession>[0]) {
  const session = (await currentSession(c))!;
  return !!(await c.env.DB.prepare(
    "SELECT id FROM customers WHERE id=? AND role IN ('admin','owner')",
  )
    .bind(session.customer.id)
    .first());
}
orders.get('/', async (c) => {
  await expireReservations(c.env);
  const session = (await currentSession(c))!;
  const result = await c.env.DB.prepare(
    'SELECT id,amount_cents,payment_state,reservation_state,invoice_url,created_at,delivery_state,delivery_date FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100',
  )
    .bind(session.customer.id)
    .all();
  return c.json({ orders: result.results });
});
orders.post('/', async (c) => {
  const parsed = orderSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Confira sacola, endereco e pagamento.' }, 400);
  const session = (await currentSession(c))!;
  const order = await createOrder(c.env, session.customer.id, parsed.data, await isCheckoutPilot(c, session));
  return c.json(
    {
      sandbox: !isProduction(c.env),
      orderId: order.id,
      paymentState: order.payment_state,
      invoiceUrl: order.invoice_url,
      amountCents: order.amount_cents,
    },
    order.invoice_url ? 201 : 202,
  );
});
orders.get('/manage', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  await expireReservations(c.env);
  const result = await c.env.DB.prepare(
    'SELECT id,customer_id,amount_cents,payment_state,reservation_state,invoice_url,created_at,delivery_state,delivery_date FROM orders ORDER BY created_at DESC LIMIT 100',
  ).all();
  return c.json({ orders: result.results });
});
orders.get('/sales-report', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const period = z.enum(['7', '30', '90']).safeParse(c.req.query('days') ?? '30');
  if (!period.success) return c.json({ error: 'Selecione um período de 7, 30 ou 90 dias.' }, 400);

  const days = Number(period.data);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const localMidnight = Date.parse(today + 'T00:00:00-03:00') / 1000;
  const start = localMidnight - (days - 1) * 86400;
  const end = localMidnight + 86400;
  const [sales, products] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT date(created_at, 'unixepoch', '-3 hours') AS day, billing_type AS method,
        payment_state AS state, COUNT(*) AS orders, SUM(amount_cents) AS amountCents
      FROM orders WHERE created_at >= ? AND created_at < ? AND json_extract(snapshot_json, '$.checkoutPilot') IS NOT 1
      GROUP BY day, method, state ORDER BY day`,
    ).bind(start, end),
    c.env.DB.prepare(
      `SELECT CAST(json_extract(item.value, '$.id') AS INTEGER) AS id,
        COALESCE(p.name, MAX(json_extract(item.value, '$.name'))) AS name,
        SUM(CAST(json_extract(item.value, '$.qty') AS INTEGER)) AS units
      FROM orders o
      JOIN json_each(o.snapshot_json, '$.items') item
      LEFT JOIN catalog_products p ON p.id = CAST(json_extract(item.value, '$.id') AS INTEGER)
      WHERE o.created_at >= ? AND o.created_at < ? AND o.payment_state = 'paid'
        AND json_extract(o.snapshot_json, '$.checkoutPilot') IS NOT 1
      GROUP BY 1, p.name ORDER BY units DESC, 1 LIMIT 5`,
    ).bind(start, end),
  ]);
  return c.json({
    dates: Array.from({ length: days }, (_, i) => new Date((start + i * 86400) * 1000).toISOString().slice(0, 10)),
    sales: sales.results,
    products: products.results,
  });
});
orders.get('/shipping-settings', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const row = await c.env.DB.prepare('SELECT data FROM shipment_settings WHERE id=1').first<{
    data: string;
  }>();
  return c.json({ sender: row ? JSON.parse(row.data) : null });
});
orders.post('/shipping-settings', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const parsed = senderSchema.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json(
        { error: 'Confira os dados do remetente: CPF ou CNPJ, telefone e endereco.' },
      400,
    );
  await c.env.DB.prepare(
    'INSERT INTO shipment_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
  )
    .bind(JSON.stringify(parsed.data))
    .run();
  return c.json({ saved: true });
});
orders.post('/sku-package', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const parsed = z
    .object({
      productId: z.number().int().positive(),
      color: z.string().min(1).max(80),
      size: z.string().min(1).max(20),
      package: packageSchema,
    })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Confira SKU, peso e medidas.' }, 400);
  const d = parsed.data;
  if (
    !(await c.env.DB.prepare(
      'SELECT product_id FROM catalog_variants WHERE product_id=? AND color=? AND size=?',
    )
      .bind(d.productId, d.color, d.size)
      .first())
  )
    return c.json({ error: 'SKU inexistente.' }, 404);
  await c.env.DB.prepare(
    'INSERT INTO sku_packages VALUES (?,?,?,?) ON CONFLICT(product_id,color,size) DO UPDATE SET data=excluded.data',
  )
    .bind(d.productId, d.color, d.size, JSON.stringify(d.package))
    .run();
  return c.json({ saved: true });
});
orders.get('/mail', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  if (isProduction(c.env) && !orderMailEnabled(c.env)) return c.json({ transport: 'disabled', messages: [] });
  if (orderMailEnabled(c.env)) {
    const result = await c.env.DB.prepare(
      `SELECT order_id,kind,state,attempts,created_at FROM order_notifications
       WHERE state IN ('queued_email','email_accepted','email_review')
       ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return c.json({ transport: isProduction(c.env) ? 'resend' : 'resend_test', messages: result.results });
  }
  await deliverLocalMail(c.env);
  const result = await c.env.DB.prepare(
    'SELECT * FROM local_order_mail ORDER BY created_at DESC LIMIT 100',
  ).all();
  return c.json({ transport: 'local', messages: result.results });
});
orders.use('/:id/*', async (c, next) => {
  const order = await getOrder(c.env, c.req.param('id')!);
  if (!order || (order.customer_id !== (await currentSession(c))!.customer.id && !(await admin(c))))
    return c.json({ error: 'Pedido nao encontrado.' }, 404);
  await next();
});
orders.get('/:id', async (c) => {
  const order = await getOrder(c.env, c.req.param('id'));
  if (!order || (order.customer_id !== (await currentSession(c))!.customer.id && !(await admin(c))))
    return c.json({ error: 'Pedido nao encontrado.' }, 404);
  const shipments = await c.env.DB.prepare(
    'SELECT id,sequence,state,tracking,tracking_url,print_url FROM shipments WHERE order_id=? ORDER BY sequence',
  )
    .bind(order.id)
    .all();
  const snapshot = JSON.parse(order.snapshot_json);
  const savedPhone = phoneSchema.safeParse(snapshot.customer?.phone);
  let contactPhone = savedPhone.success ? savedPhone.data : '';
  if (!contactPhone && await admin(c)) {
    const profile = await c.env.DB.prepare('SELECT phone FROM customer_profiles WHERE customer_id=?')
      .bind(order.customer_id).first<{ phone: string }>();
    const phone = phoneSchema.safeParse(profile?.phone);
    if (phone.success) contactPhone = phone.data;
  }
  return c.json({
    order: {
      id: order.id,
      amountCents: order.amount_cents,
      paymentState: order.payment_state,
      deliveryState: order.delivery_state,
      deliveryDate: order.delivery_date,
      reservationState: order.reservation_state,
      invoiceUrl: order.invoice_url,
      snapshot,
      contactPhone,
      fiscal: order.fiscal_json ? JSON.parse(order.fiscal_json) : null,
    },
    shipments: shipments.results,
  });
});
orders.post('/:id/reconcile', async (c) => {
  const order = await reconcilePayment(c.env, (await getOrder(c.env, c.req.param('id')))!);
  return c.json({ paymentState: order.payment_state });
});
orders.post('/:id/delivery', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const parsed = z.discriminatedUnion('state', [
    z.object({ state: z.literal('to_arrange'), date: z.null() }).strict(),
    z.object({ state: z.literal('scheduled'), date: z.iso.date() }).strict(),
    z.object({ state: z.literal('delivered'), date: z.iso.date() }).strict(),
  ]).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Informe um status e uma data de entrega válidos.' }, 400);
  const { state, date } = parsed.data;
  const result = await c.env.DB.prepare(
    "UPDATE orders SET delivery_state=?, delivery_date=? WHERE id=? AND (?='to_arrange' OR payment_state='paid')",
  ).bind(state, date, c.req.param('id'), state).run();
  if (!result.meta.changes)
    return c.json({ error: 'Confirme o pagamento antes de agendar ou registrar a entrega.' }, 409);
  return c.json({ saved: true });
});
orders.post('/:id/fiscal', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const parsed = fiscalSchema.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: 'Informe a chave de 44 digitos da nota fiscal.' }, 400);
  if (
    await c.env.DB.prepare("SELECT id FROM shipments WHERE order_id=? AND state!='cancelled'")
      .bind(c.req.param('id'))
      .first()
  )
    return c.json({ error: 'Nota fiscal ja vinculada a expedicao.' }, 409);
  await c.env.DB.prepare('UPDATE orders SET fiscal_json=? WHERE id=?')
    .bind(JSON.stringify(parsed.data), c.req.param('id'))
    .run();
  return c.json({ saved: true });
});
orders.post('/:id/shipment', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  return c.json({
    shipment: await prepareShipment(c.env, (await getOrder(c.env, c.req.param('id')))!),
  });
});
orders.post('/:id/shipment/test-content', async (c) => {
  if (c.env.APP_ENV !== 'staging') return c.notFound();
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const order = (await getOrder(c.env, c.req.param('id')))!;
  if (order.customer_id !== (await currentSession(c))!.customer.id)
    return c.json({ error: 'Use a sessao da conta ficticia do pedido.' }, 403);
  return c.json({ shipment: await prepareShipment(c.env, order, 'test-content') });
});
orders.post('/:id/shipment/:shipmentId/:action', async (c) => {
  if (!(await admin(c))) return c.json({ error: 'Acesso restrito.' }, 403);
  const shipment = await getShipment(c.env, c.req.param('shipmentId'));
  if (!shipment || shipment.order_id !== c.req.param('id'))
    return c.json({ error: 'Etiqueta nao encontrada.' }, 404);
  const action = c.req.param('action');
  if (action === 'reconcile') return c.json({ shipment: await reconcileShipment(c.env, shipment) });
  if (!['cart', 'purchase', 'generate', 'print', 'cancel'].includes(action))
    return c.json({ error: 'Operacao desconhecida.' }, 404);
  const body = await c.req.json();
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : undefined;
  return c.json({
    shipment: await shippingAction(
      c.env,
      shipment,
      action as 'cart' | 'purchase' | 'generate' | 'print' | 'cancel',
      reason,
    ),
  });
});
export default orders;
