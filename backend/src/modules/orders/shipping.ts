import { z } from 'zod';
import type { Env } from '../../env';
import { now } from '../auth/session';
import { IntegrationError, providerRequest } from '../integrations/providers';
import {
  getOrder,
  notifyStatement,
  deliverLocalMail,
  reconcilePayment,
  type Order,
} from './service';

const text = z.string().trim().min(1).max(120);
export const senderSchema = z
  .object({
    name: text,
    phone: z.string().regex(/^\d{10,11}$/),
    email: z.string().email(),
    company_document: z.string().regex(/^\d{14}$/).optional(),
    document: z.string().regex(/^\d{11}$/).optional(),
    state_register: z.string().trim().max(120).default(''),
    address: text,
    number: text,
    complement: z.string().max(120).default(''),
    district: text,
    city: text,
    state_abbr: z.string().regex(/^[A-Z]{2}$/),
    postal_code: z.string().regex(/^\d{8}$/),
  })
  .strict()
  .refine(v => Boolean(v.company_document) !== Boolean(v.document), { message: 'Informe somente CPF ou CNPJ do remetente.' });
export const packageSchema = z
  .object({
    weight: z.number().positive().max(100),
    width: z.number().positive().max(300),
    height: z.number().positive().max(300),
    length: z.number().positive().max(300),
  })
  .strict();
export const fiscalSchema = z.object({ key: z.string().regex(/^\d{44}$/) }).strict();
export type Shipment = {
  id: string;
  order_id: string;
  sequence: number;
  state: string;
  provider_id: string | null;
  tracking: string | null;
  tracking_url: string | null;
  print_url: string | null;
  payload_json: string;
  last_status_at: string | null;
};
export async function getShipment(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM shipments WHERE id=?').bind(id).first<Shipment>();
}

export async function prepareShipment(env: Env, order: Order, mode: 'commercial' | 'test-content' = 'commercial') {
  if (mode === 'test-content') {
    const fixture = env.APP_ENV === 'staging' && await env.DB.prepare(
      "SELECT 1 FROM customers WHERE id=? AND password_hash='disabled-fixture' AND email LIKE '%@example.test'",
    ).bind(order.customer_id).first();
    if (!fixture || order.fiscal_json)
      throw new IntegrationError('Declaracao de teste disponivel apenas para pedidos ficticios sem nota.', 409);
  }
  order = await reconcilePayment(env, order);
  if (order.payment_state !== 'paid' || order.reservation_state !== 'active')
    throw new IntegrationError('Pagamento ou reserva nao liberados para expedicao.', 409);
  const fiscal = fiscalSchema.safeParse(order.fiscal_json ? JSON.parse(order.fiscal_json) : null);
  const config = await env.DB.prepare('SELECT data FROM shipment_settings WHERE id=1').first<{
    data: string;
  }>();
  const sender = senderSchema.safeParse(config ? JSON.parse(config.data) : null);
  if (!sender.success || (!fiscal.success && mode === 'commercial'))
    throw new IntegrationError(
      'Preencha a chave da nota fiscal e os dados completos do remetente.',
      409,
    );
  if (mode === 'test-content' &&
      (!sender.data.email.endsWith('@example.test') || !sender.data.document || sender.data.state_register))
    throw new IntegrationError('Use um remetente ficticio de pessoa fisica para a declaracao de teste.', 409);
  const snapshot = JSON.parse(order.snapshot_json),
    { address, customer, items, shipping } = snapshot;
  if (!shipping?.dimensionsVerified)
    throw new IntegrationError(
      'Cadastre peso e medidas reais por SKU e faca uma nova cotacao.',
      409,
    );
  if (sender.data.postal_code !== snapshot.originCep)
    throw new IntegrationError('CEP de origem mudou. Revise a cotacao antes da expedicao.', 409);
  // A quote's package geometry must be preserved; never fabricate label dimensions.
  const packages = z
    .array(
      z
        .object({
          weight: z.coerce.number().positive(),
          dimensions: z.object({
            width: z.coerce.number().positive(),
            height: z.coerce.number().positive(),
            length: z.coerce.number().positive(),
          }),
        })
        .passthrough(),
    )
    .min(1)
    .max(1)
    .safeParse(shipping.packages);
  if (!packages.success)
    throw new IntegrationError(
      'Cotacao sem pacote unico valido. Revise peso e medidas antes de emitir a etiqueta.',
      409,
    );
  const existing = await env.DB.prepare(
    "SELECT * FROM shipments WHERE order_id=? AND state!='cancelled' ORDER BY sequence DESC LIMIT 1",
  )
    .bind(order.id)
    .first<Shipment>();
  if (existing) return existing;
  const sequence = await env.DB.prepare(
    'SELECT COALESCE(MAX(sequence),0)+1 AS n FROM shipments WHERE order_id=?',
  )
    .bind(order.id)
    .first<{ n: number }>();
  const id = crypto.randomUUID(),
    sequenceNo = sequence!.n;
  const payload = {
    service: Number(shipping.id),
    from: sender.data,
    to: {
      name: address.recipient,
      phone: customer.phone,
      email: customer.email,
      document: customer.cpf,
      address: address.street,
      number: address.number,
      complement: address.complement,
      district: address.neighborhood,
      city: address.city,
      state_abbr: address.state,
      postal_code: address.cep,
    },
    products: items.map((i: { name: string; qty: number; priceCents: number }) => ({
      name: i.name,
      quantity: i.qty,
      unitary_value: i.priceCents / 100,
    })),
    volumes: packages.data.map((p) => ({ ...p.dimensions, weight: p.weight })),
    options: {
      insurance_value: snapshot.subtotalCents / 100,
      receipt: false,
      own_hand: false,
      non_commercial: mode === 'test-content',
      ...(mode === 'commercial' && fiscal.success ? { invoice: { key: fiscal.data.key } } : {}),
      platform: 'Mascavo Fitwear Sandbox',
      tags: [{ tag: order.id, url: null }],
    },
  };
  await env.DB.prepare(
    'INSERT OR IGNORE INTO shipments(id,order_id,sequence,payload_json,updated_at) VALUES (?,?,?,?,?)',
  )
    .bind(id, order.id, sequenceNo, JSON.stringify(payload), now())
    .run();
  return (await env.DB.prepare('SELECT * FROM shipments WHERE order_id=? AND sequence=?')
    .bind(order.id, sequenceNo)
    .first<Shipment>())!;
}

export async function applyShippingStatus(
  env: Env,
  shipment: Shipment,
  data: Record<string, any>,
  timestamp?: string,
) {
  if (data.id !== shipment.provider_id) throw new IntegrationError('Etiqueta divergente.', 409);
  const allowed = [
    'pending',
    'released',
    'generated',
    'received',
    'posted',
    'delivered',
    'cancelled',
    'undelivered',
    'paused',
    'suspended',
  ];
  if (!allowed.includes(data.status))
    throw new IntegrationError('Status de etiqueta desconhecido.', 409);
  const rank: Record<string, number> = {
    new: 0,
    pending: 1,
    released: 2,
    generated: 3,
    received: 4,
    posted: 5,
    paused: 6,
    suspended: 6,
    undelivered: 6,
    delivered: 7,
    cancelled: 8,
  };
  const current = (await getShipment(env, shipment.id))!;
  const eventTime = timestamp ? Date.parse(timestamp) : NaN;
  if (
    Number.isFinite(eventTime) &&
    current.last_status_at &&
    eventTime < Date.parse(current.last_status_at)
  )
    return current;
  if (
    (rank[data.status] || 0) < (rank[current.state] || 0) ||
    (['delivered', 'cancelled'].includes(current.state) && data.status !== current.state)
  )
    return current;
  let trackingUrl: null | string = null;
  if (data.tracking_url) {
    try {
      const u = new URL(data.tracking_url);
      if (
        u.protocol === 'https:' &&
        ['www.melhorrastreio.com.br', 'melhorrastreio.com.br'].includes(u.hostname)
      )
        trackingUrl = u.href;
    } catch {}
  }
  const tracking = typeof data.tracking === 'string' ? data.tracking.slice(0, 100) : null;
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE shipments SET state=?,tracking=COALESCE(?,tracking),tracking_url=COALESCE(?,tracking_url),last_status_at=COALESCE(?,last_status_at),updated_at=? WHERE id=? AND state=?',
    ).bind(
      data.status,
      tracking,
      trackingUrl,
      Number.isFinite(eventTime) ? new Date(eventTime).toISOString() : null,
      now(),
      current.id,
      current.state,
    ),
  ]);
  const result = (await getShipment(env, current.id))!;
  if (['posted', 'delivered', 'undelivered', 'paused', 'suspended'].includes(result.state))
    await notifyStatement(env, result.order_id, `shipment_${result.state}`, {
      tracking: result.tracking,
    }).run();
  if (result.tracking)
    await notifyStatement(env, result.order_id, 'tracking_available', {
      tracking: result.tracking,
    }).run();
  await deliverLocalMail(env);
  return result;
}
export async function reconcileShipment(env: Env, shipment: Shipment) {
  if (!shipment.provider_id)
    throw new IntegrationError(
      'Resultado do carrinho desconhecido. Confira o painel antes de repetir.',
      409,
    );
  const result = await providerRequest<Record<string, any>>(
    env,
    'shipping',
    '/me/shipment/tracking',
    { orders: [shipment.provider_id] },
  );
  let data = result[shipment.provider_id];
  if (!data || data.id !== shipment.provider_id)
    throw new IntegrationError('Etiqueta nao retornada na conciliacao.', 409);
  // Sandbox tracking can still say "released" after the order detail records generation.
  if (shipment.state === 'released' && data.status === 'released') {
    const generation = await env.DB.prepare(
      "SELECT 1 FROM shipment_operations WHERE shipment_id=? AND action='generate' AND state='submitted'",
    ).bind(shipment.id).first();
    if (generation) {
      const detail = await providerRequest<{
        id?: string;
        status?: string;
        generated_at?: string;
      }>(env, 'shipping', '/me/orders/' + encodeURIComponent(shipment.provider_id), undefined, 'GET')
        .catch(() => null);
      if (detail?.id === shipment.provider_id &&
          ['released', 'generated'].includes(detail.status ?? '') &&
          typeof detail.generated_at === 'string' && Number.isFinite(Date.parse(detail.generated_at))) {
        data = { ...data, status: 'generated', generated_at: detail.generated_at, updated_at: detail.generated_at };
      }
    }
  }
  const updated = await applyShippingStatus(
    env,
    shipment,
    data,
    data.updated_at ||
      data.delivered_at ||
      data.posted_at ||
      data.generated_at ||
      data.paid_at ||
      data.created_at,
  );
  // Only explicit rejections can be retried after a read. A pending status cannot
  // prove that an ambiguous purchase will not settle later.
  if (updated.state === 'pending')
    await env.DB.prepare(
      "DELETE FROM shipment_operations WHERE shipment_id=? AND action='purchase' AND state='failed'",
    )
      .bind(updated.id)
      .run();
  if (updated.state === 'released')
    await env.DB.prepare(
      "DELETE FROM shipment_operations WHERE shipment_id=? AND action='generate' AND state='failed'",
    )
      .bind(updated.id)
      .run();
  return updated;
}

export async function shippingAction(
  env: Env,
  shipment: Shipment,
  action: 'cart' | 'purchase' | 'generate' | 'print' | 'cancel',
  reason = 'Cancelamento solicitado pela loja',
) {
  const order = (await getOrder(env, shipment.order_id))!;
  if (action !== 'cancel' && (await reconcilePayment(env, order)).payment_state !== 'paid')
    throw new IntegrationError('Pagamento nao confirmado.', 409);
  if (action === 'cart' && shipment.provider_id) return shipment;
  if (action !== 'cart' && !shipment.provider_id)
    throw new IntegrationError('Crie ou concilie a etiqueta primeiro.', 409);
  if (
    action === 'purchase' &&
    ['released', 'generated', 'received', 'posted', 'delivered'].includes(shipment.state)
  )
    return shipment;
  if (
    action === 'generate' &&
    ['generated', 'received', 'posted', 'delivered'].includes(shipment.state)
  )
    return shipment;
  if (
    action === 'print' &&
    !['generated', 'received', 'posted', 'delivered'].includes(shipment.state)
  )
    throw new IntegrationError('Gere a etiqueta antes de imprimir.', 409);
  if (action === 'cancel' && shipment.state === 'cancelled') return shipment;
  if (action === 'cancel' && ['received', 'posted', 'delivered'].includes(shipment.state))
    throw new IntegrationError('Envio ja postado; cancelamento indisponivel.', 409);
  if (action === 'purchase' && shipment.state !== 'pending')
    throw new IntegrationError('Concilie o carrinho antes da compra.', 409);
  if (action === 'generate' && shipment.state !== 'released')
    throw new IntegrationError('Aguarde a confirmacao da compra da etiqueta.', 409);
  if (action === 'print' && shipment.print_url) return shipment;
  const lock = await env.DB.prepare(
    "INSERT OR IGNORE INTO shipment_operations VALUES (?,?,'processing',?)",
  )
    .bind(shipment.id, action, now())
    .run();
  if (!lock.meta.changes)
    throw new IntegrationError('Operacao ja iniciada; concilie antes de repetir.', 409);
  const paths = {
    cart: '/me/cart',
    purchase: '/me/shipment/checkout',
    generate: '/me/shipment/generate',
    print: '/me/shipment/print',
    cancel: '/me/shipment/cancel',
  };
  const body =
    action === 'cart'
      ? JSON.parse(shipment.payload_json)
      : action === 'cancel'
        ? { order: { id: shipment.provider_id, reason_id: '2', description: reason } }
        : action === 'print'
          ? { orders: [shipment.provider_id], mode: 'private' }
          : { orders: [shipment.provider_id] };
  try {
    const result = await providerRequest<Record<string, any>>(env, 'shipping', paths[action], body);
    if (action === 'cart') {
      if (typeof result.id !== 'string') throw new Error('Invalid cart response');
      await env.DB.prepare(
        "UPDATE shipments SET provider_id=?,state='pending',updated_at=? WHERE id=?",
      )
        .bind(result.id, now(), shipment.id)
        .run();
    } else if (action === 'print') {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'sandbox.melhorenvio.com.br')
        throw new Error('Invalid print URL');
      await env.DB.prepare('UPDATE shipments SET print_url=?,updated_at=? WHERE id=?')
        .bind(url.href, now(), shipment.id)
        .run();
    }
    // Purchase/generate/cancel are confirmed through authoritative tracking, never assumed from HTTP 200.
    await env.DB.prepare(
      "UPDATE shipment_operations SET state='submitted',updated_at=? WHERE shipment_id=? AND action=?",
    )
      .bind(now(), shipment.id, action)
      .run();
  } catch (error) {
    const explicit =
      error instanceof IntegrationError && /HTTP (400|401|402|403|422|429)\)/.test(error.message);
    await env.DB.prepare(
      'UPDATE shipment_operations SET state=?,updated_at=? WHERE shipment_id=? AND action=?',
    )
      .bind(explicit ? 'failed' : 'review', now(), shipment.id, action)
      .run();
    if (explicit && action === 'cart')
      await env.DB.prepare(
        "DELETE FROM shipment_operations WHERE shipment_id=? AND action='cart' AND state='failed'",
      )
        .bind(shipment.id)
        .run();
    throw new IntegrationError(
      explicit
        ? 'Provedor recusou a operacao. Corrija e concilie antes de repetir.'
        : 'Resultado desconhecido. Confira e concilie antes de repetir.',
      409,
    );
  }
  const fresh = (await getShipment(env, shipment.id))!;
  return action === 'print' || action === 'cart' ? fresh : reconcileShipment(env, fresh);
}
