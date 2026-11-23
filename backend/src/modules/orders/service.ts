import { z } from 'zod';
import type { Env } from '../../env';
import { now } from '../auth/session';
import { phoneSchema, requiredCpfSchema } from '../auth/profile';
import { cartSnapshot, paymentAmount, paymentChoiceSchema } from '../integrations/checkout';
import { IntegrationError, providerRequest } from '../integrations/providers';
import { orderMailState } from './mail';
import { asaasCredentialsMatch, asaasInvoiceUrl, checkoutEnabled, deliveryTerms, integratedShippingEnabled, isProduction, paymentMethods, PILOT_PRODUCT_ID, pilotAmount } from '../../commerce-environment';

export type Order = {
  id: string;
  customer_id: string;
  request_json: string;
  snapshot_json: string;
  amount_cents: number;
  billing_type: string;
  installments: number;
  payment_state: string;
  reservation_state: string;
  expires_at: number;
  provider_customer: string | null;
  provider_id: string | null;
  installment_id: string | null;
  invoice_url: string | null;
  fiscal_json: string | null;
  payment_revision: number;
  delivery_state: 'to_arrange' | 'scheduled' | 'delivered';
  delivery_date: string | null;
};
export const orderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            color: z.string().min(1).max(80),
            size: z.string().min(1).max(20),
            qty: z.number().int().min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    addressId: z.string().uuid(),
    quoteId: z.string().uuid().optional(),
    serviceId: z.string().min(1).max(20).optional(),
    requestKey: z.string().uuid(),
    billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']),
    installments: z.number().int().min(1).max(3),
    expectedAmountCents: z.number().int().positive().optional(),
  })
  .strict();
export async function getOrder(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<Order>();
}
export function notifyStatement(env: Env, orderId: string, kind: string, payload: unknown = {}, recipient?: string) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO order_notifications(id,order_id,kind,recipient,payload_json,created_at,state)
 SELECT ?,o.id,?,COALESCE(?,c.email),json_object('orderId',o.id,'amountCents',o.amount_cents,'notification',json(?)),?,? FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`,
  ).bind(crypto.randomUUID(), kind, recipient ?? null, JSON.stringify(payload), now(), orderMailState(env, kind), orderId);
}
export async function deliverLocalMail(env: Env) {
  // Local-only transport: no automated test or Sandbox operation sends customer email.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO local_order_mail(id,recipient,subject,payload_json,created_at)
    SELECT id,recipient,kind,payload_json,? FROM order_notifications WHERE state='pending'`,
    ).bind(now()),
    env.DB.prepare(`UPDATE order_notifications SET state='delivered_local',attempts=attempts+1
    WHERE state='pending' AND id IN (SELECT id FROM local_order_mail)`),
  ]);
}
export async function expireReservations(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT id FROM orders WHERE reservation_state='active' AND expires_at<=? AND payment_state NOT IN ('paid','refund','chargeback')",
  )
    .bind(now())
    .all<{ id: string }>();
  for (const { id } of rows.results) {
    const items = await env.DB.prepare('SELECT * FROM order_items WHERE order_id=?')
      .bind(id)
      .all<{ product_id: number; color: string; size: string; qty: number }>();
    await env.DB.batch([
      ...items.results.map((i) =>
        env.DB.prepare(
          `UPDATE catalog_variants SET stock=stock+? WHERE product_id=? AND color=? AND size=?
    AND EXISTS(SELECT 1 FROM orders WHERE id=? AND reservation_state='active' AND expires_at<=? AND payment_state NOT IN ('paid','refund','chargeback'))`,
        ).bind(i.qty, i.product_id, i.color, i.size, id, now()),
      ),
      env.DB.prepare(
        `UPDATE orders SET reservation_state='released' WHERE id=? AND reservation_state='active' AND expires_at<=? AND payment_state NOT IN ('paid','refund','chargeback')`,
      ).bind(id, now()),
    ]);
  }
}
export async function createOrder(
  env: Env,
  customerId: string,
  input: z.infer<typeof orderSchema>,
  pilot = false,
) {
  const request = JSON.stringify(input);
  const previous = await env.DB.prepare(
    'SELECT * FROM orders WHERE customer_id=? AND request_key=?',
  )
    .bind(customerId, input.requestKey)
    .first<Order>();
  if (previous) {
    if (previous.request_json !== request)
      throw new IntegrationError('Tentativa reutilizada com outros dados.', 409);
    return previous;
  }
  if (!pilot && !checkoutEnabled(env)) throw new IntegrationError('As vendas ainda não estão abertas.', 503);
  const production = isProduction(env);
  if (!(pilot ? ['PIX'] : paymentMethods(env)).includes(input.billingType))
    throw new IntegrationError('Forma de pagamento indisponível.', 400);
  if (pilot && (input.items.length !== 1 || input.items[0].id !== PILOT_PRODUCT_ID || input.items[0].qty !== 1))
    throw new IntegrationError('Selecione apenas uma unidade do produto de teste.', 400);
  if (!pilot && input.items.some(item => item.id === PILOT_PRODUCT_ID))
    throw new IntegrationError('Produto indisponível.', 400);
  if (pilot && await env.DB.prepare(
    "SELECT 1 FROM orders WHERE customer_id=? AND json_extract(snapshot_json,'$.checkoutPilot')=1 LIMIT 1",
  ).bind(customerId).first()) throw new IntegrationError('O pedido de teste já foi criado. Consulte Minha conta.', 409);
  if (!paymentChoiceSchema.safeParse(input).success)
    throw new IntegrationError('Parcelamento invalido.', 400);
  if (!asaasCredentialsMatch(env)) throw new IntegrationError('Configure o Asaas para este ambiente.', 503);
  await expireReservations(env);
  const customer = await env.DB.prepare(
    `SELECT c.name,c.email,c.email_verified_at,p.cpf,p.phone FROM customers c JOIN customer_profiles p ON p.customer_id=c.id WHERE c.id=?`,
  )
    .bind(customerId)
    .first<{ name: string; email: string; cpf: string; phone: string; email_verified_at: number | null }>();
  const address = await env.DB.prepare(
    'SELECT * FROM customer_addresses WHERE id=? AND customer_id=?',
  )
    .bind(input.addressId, customerId)
    .first<Record<string, string>>();
  if (!customer || !requiredCpfSchema.safeParse(customer.cpf).success || !address)
    throw new IntegrationError('Preencha o CPF e o endereço de entrega em Minha conta.', 400);
  if (production && !customer.email_verified_at)
    throw new IntegrationError('Confirme seu e-mail em Minha conta antes de fazer o pedido.', 400);
  const phone = phoneSchema.safeParse(customer.phone);
  if (!phone.success)
    throw new IntegrationError('Cadastre um telefone válido com DDD em Minha conta para finalizar o pedido.', 400);
  customer.phone = phone.data;
  const seen = new Set<string>();
  const items = [];
  for (const i of input.items) {
    const key = JSON.stringify([i.id, i.color, i.size]);
    if (seen.has(key)) throw new IntegrationError('Itens repetidos.', 400);
    seen.add(key);
    const row = await env.DB.prepare(
      `SELECT p.name,p.price_cents,p.provisional,v.stock FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.id=? AND p.active=1 AND v.color=? AND v.size=?`,
    )
      .bind(i.id, i.color, i.size)
      .first<{ name: string; price_cents: number; provisional: number; stock: number }>();
    if (!row || row.stock < i.qty) throw new IntegrationError('Estoque insuficiente.', 409);
    if (production && row.provisional) throw new IntegrationError('Um dos produtos ainda não está disponível para compra.', 409);
    items.push({ ...i, name: row.name, priceCents: row.price_cents });
  }
  let shipping: { priceCents: number; originCep?: string } | null = null;
  if (integratedShippingEnabled(env)) {
    if (!input.quoteId || !input.serviceId)
      throw new IntegrationError('Selecione o frete para este endereco.', 400);
    const quote = await env.DB.prepare(
      'SELECT * FROM sandbox_shipping_quotes WHERE id=? AND customer_id=?',
    )
      .bind(input.quoteId, customerId)
      .first<{ cart_json: string; cep: string; rates_json: string; expires_at: number }>();
    if (
      !quote ||
      quote.expires_at <= now() ||
      quote.cep !== address.cep ||
      quote.cart_json !== cartSnapshot(items.map(({ name, ...i }) => i))
    )
      throw new IntegrationError('Consulte novamente o frete para este endereco.', 409);
    shipping = JSON.parse(quote.rates_json).find(
      (r: { id: string }) => r.id === input.serviceId,
    );
    if (!shipping) throw new IntegrationError('Frete invalido.', 400);
  } else if (input.quoteId || input.serviceId) {
    throw new IntegrationError('Combine o envio com a loja. Atualize o checkout.', 409);
  }
  const terms = production && !pilot ? deliveryTerms(env) : null;
  if (terms && !terms.cepPrefixes.some(prefix => address.cep.startsWith(prefix)))
    throw new IntegrationError('Este endereço está fora da região de entrega da loja.', 400);
  const deliveryFeeCents = terms?.feeCents ?? shipping?.priceCents ?? 0;
  const subtotal = items.reduce((n, i) => n + i.qty * i.priceCents, 0),
    amount = subtotal + deliveryFeeCents;
  if (production && input.expectedAmountCents !== amount)
    throw new IntegrationError('O total mudou. Atualize a sacola e confira os valores antes de pagar.', 409);
  if (pilot && amount !== pilotAmount(env))
    throw new IntegrationError('O valor do teste diverge do valor autorizado.', 409);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO orders(id,customer_id,request_key,request_json,snapshot_json,amount_cents,billing_type,installments,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id,
        customerId,
        input.requestKey,
        request,
        JSON.stringify({
          customer: { name: customer.name, email: customer.email, cpf: customer.cpf, phone: customer.phone },
          address,
          items,
          shipping,
          subtotalCents: subtotal,
          deliveryFeeCents,
          deliveryEstimate: terms?.estimate,
          ...(pilot ? { checkoutPilot: true } : {}),
          originCep: shipping ? shipping.originCep || env.SHIPPING_ORIGIN_CEP : undefined,
        }),
        amount,
        input.billingType,
        input.installments,
        now() + (production ? 4 * 86400 : 1800),
        now(),
      ),
      ...items.flatMap((i) => [
        env.DB.prepare(
          'UPDATE catalog_variants SET stock=stock-? WHERE product_id=? AND color=? AND size=? AND stock>=?',
        ).bind(i.qty, i.id, i.color, i.size, i.qty),
        env.DB.prepare('INSERT INTO order_stock_checks(id,ok) VALUES (?,changes())').bind(
          crypto.randomUUID(),
        ),
        env.DB.prepare('INSERT INTO order_items VALUES (?,?,?,?,?)').bind(
          id,
          i.id,
          i.color,
          i.size,
          i.qty,
        ),
      ]),
      env.DB.prepare('DELETE FROM order_stock_checks'),
      notifyStatement(env, id, 'order_created'),
      ...(isProduction(env) && env.ORDER_EMAIL_STORE_TO?.trim()
        ? [notifyStatement(env, id, 'staff_order_created', {}, env.ORDER_EMAIL_STORE_TO.trim())]
        : []),
    ]);
  } catch {
    const concurrent = await env.DB.prepare(
      'SELECT * FROM orders WHERE customer_id=? AND request_key=?',
    )
      .bind(customerId, input.requestKey)
      .first<Order>();
    if (concurrent?.request_json === request) return concurrent;
    throw new IntegrationError('Estoque ou tentativa alterados. Atualize sua sacola.', 409);
  }
  try {
    const payer = await providerRequest<{ id: string }>(env, 'asaas', '/customers', {
      name: customer.name,
      cpfCnpj: customer.cpf,
      email: customer.email,
      notificationDisabled: true,
      externalReference: id,
    });
    if (!payer.id) throw new Error('Missing payer');
    await env.DB.prepare('UPDATE orders SET provider_customer=? WHERE id=?')
      .bind(payer.id, id)
      .run();
    const payment = await providerRequest<{ id: string; invoiceUrl: string; installment?: string }>(
      env,
      'asaas',
      '/payments',
      {
        customer: payer.id,
        billingType: input.billingType,
        ...paymentAmount(amount, input.installments),
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        description: `Pedido ${pilot ? 'Teste ' : production ? '' : 'Sandbox '}Mascavo ${id}`,
        externalReference: id,
      },
    );
    const invoiceUrl = asaasInvoiceUrl(payment.invoiceUrl, env);
    if (!payment.id || (input.installments > 1 && !payment.installment))
      throw new Error('Invalid payment');
    await env.DB.prepare(
      "UPDATE orders SET provider_id=?,installment_id=?,invoice_url=?,payment_state='pending' WHERE id=?",
    )
      .bind(payment.id, payment.installment || null, invoiceUrl, id)
      .run();
  } catch {
    await env.DB.prepare("UPDATE orders SET payment_state='review' WHERE id=?").bind(id).run();
  }
  await deliverLocalMail(env);
  return (await getOrder(env, id))!;
}

export async function reconcilePayment(env: Env, order: Order) {
  if (!order.provider_id) {
    const list = await providerRequest<{
      data: { id: string; customer: string; externalReference: string; installment?: string }[];
      hasMore: boolean;
    }>(
      env,
      'asaas',
      `/payments?externalReference=${encodeURIComponent(order.id)}&limit=100`,
      null,
      'GET',
    );
    if (
      !Array.isArray(list.data) ||
      list.hasMore ||
      list.data.length !== order.installments ||
      list.data.some((p) => p.externalReference !== order.id) ||
      new Set(list.data.map((p) => p.customer)).size !== 1
    )
      throw new IntegrationError(
        'Cobranca sem identificador confirmado. Confira o painel Asaas.',
        409,
      );
    const payment = list.data[0];
    if (order.provider_customer && order.provider_customer !== payment.customer)
      throw new IntegrationError('Titular da cobranca divergente.', 409);
    if (!order.provider_customer) {
      const payer = await providerRequest<{ cpfCnpj: string; externalReference: string }>(
        env,
        'asaas',
        `/customers/${encodeURIComponent(payment.customer)}`,
        null,
        'GET',
      );
      if (
        payer.cpfCnpj?.replace(/\D/g, '') !== JSON.parse(order.snapshot_json).customer.cpf ||
        payer.externalReference !== order.id
      )
        throw new IntegrationError('Titular da cobranca divergente.', 409);
    }
    if (
      order.installments > 1 &&
      (!payment.installment || list.data.some((p) => p.installment !== payment.installment))
    )
      throw new IntegrationError('Grupo de parcelas divergente.', 409);
    await env.DB.prepare(
      'UPDATE orders SET provider_id=?,provider_customer=?,installment_id=? WHERE id=? AND provider_id IS NULL',
    )
      .bind(payment.id, payment.customer, payment.installment || null, order.id)
      .run();
    order = (await getOrder(env, order.id))!;
  }
  if (!order.provider_customer)
    throw new IntegrationError('Titular da cobranca indisponivel.', 409);
  await expireReservations(env);
  const fresh = (await getOrder(env, order.id))!;
  type Payment = {
    id: string;
    customer: string;
    externalReference: string;
    value: number;
    status: string;
    installment?: string;
    deleted?: boolean;
    refundedValue?: number;
  };
  let payments: Payment[];
  if (fresh.installment_id) {
    const list = await providerRequest<{ data: Payment[]; hasMore: boolean }>(
      env,
      'asaas',
      `/installments/${encodeURIComponent(fresh.installment_id)}/payments?limit=100`,
      null,
      'GET',
    );
    if (!Array.isArray(list.data) || list.hasMore)
      throw new IntegrationError('Parcelamento incompleto.', 409);
    payments = list.data;
  } else
    payments = [
      await providerRequest<Payment>(
        env,
        'asaas',
        `/payments/${encodeURIComponent(fresh.provider_id!)}`,
        null,
        'GET',
      ),
    ];
  if (
    payments.length !== fresh.installments ||
    new Set(payments.map((p) => p.id)).size !== payments.length ||
    !payments.some((p) => p.id === fresh.provider_id) ||
    payments.some(
      (p) =>
        p.customer !== fresh.provider_customer ||
        p.externalReference !== fresh.id ||
        (fresh.installment_id && p.installment !== fresh.installment_id),
    ) ||
    payments.reduce((n, p) => n + Math.round(p.value * 100), 0) !== fresh.amount_cents
  )
    throw new IntegrationError(
      'Titular, referencia, valor ou parcelas divergentes. Revisao necessaria.',
      409,
    );
  const statuses = payments.map((p) => p.status);
  let state = 'pending';
  if (statuses.some((s) => s.includes('CHARGEBACK'))) state = 'chargeback';
  else if (
    statuses.some((s) => s.includes('REFUND')) ||
    payments.some((p) => (p.refundedValue || 0) > 0)
  )
    state = 'refund';
  else if (statuses.every((s) => ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(s)))
    state = fresh.reservation_state === 'released' ? 'late_payment' : 'paid';
  else if (
    payments.some((p) => p.deleted) ||
    statuses.some((s) => ['DELETED', 'CANCELLED', 'REFUSED', 'DUNNING_REQUESTED'].includes(s))
  )
    state = 'blocked';
  // Financial reversals are never erased by an old/pending notification.
  if (
    ['refund', 'chargeback'].includes(fresh.payment_state) &&
    !['refund', 'chargeback'].includes(state)
  )
    state = fresh.payment_state;
  if (fresh.payment_state === 'paid' && state === 'pending') state = 'paid';
  const lock = await env.DB.prepare(
    'UPDATE orders SET payment_state=?,payment_revision=payment_revision+1 WHERE id=? AND payment_revision=? AND reservation_state=?',
  )
    .bind(state, fresh.id, fresh.payment_revision, fresh.reservation_state)
    .run();
  if (!lock.meta.changes)
    throw new IntegrationError('Pagamento mudou durante a consulta. Repita a conciliacao.', 409);
  if (state === 'paid') await notifyStatement(env, fresh.id, 'payment_confirmed').run();
  if (['refund', 'chargeback', 'late_payment'].includes(state))
    await notifyStatement(env, fresh.id, state).run();
  await deliverLocalMail(env);
  return (await getOrder(env, fresh.id))!;
}
