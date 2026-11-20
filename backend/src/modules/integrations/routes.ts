import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../../env';
import { currentSession, csrfCookie, now } from '../auth/session';
import { equal } from '../auth/crypto';
import { cartSnapshot, paymentAmount, paymentChoiceSchema } from './checkout';
import { IntegrationError, providerRequest, shippingDimensions } from './providers';

const itemsSchema = z.array(z.object({
  id: z.number().int().positive(), color: z.string().min(1).max(80),
  size: z.string().min(1).max(20), qty: z.number().int().min(1).max(10),
}).strict()).min(1).max(20);
type Items = z.infer<typeof itemsSchema>;
async function catalogItems(env: Env, items: Items) {
  const seen = new Set<string>();
  const result = [];
  for (const item of items) {
    const key = JSON.stringify([item.id, item.color, item.size]);
    if (seen.has(key)) throw new IntegrationError('Há itens repetidos na sacola.', 400);
    seen.add(key);
    const row = await env.DB.prepare(`SELECT p.price_cents,v.stock FROM catalog_products p JOIN catalog_variants v ON p.id=v.product_id WHERE p.id=? AND p.active=1 AND v.color=? AND v.size=?`)
      .bind(item.id, item.color, item.size).first<{ price_cents: number; stock: number }>();
    if (!row || row.stock < item.qty) throw new IntegrationError('Produto indisponível ou quantidade acima do estoque.', 400);
    result.push({ ...item, priceCents: row.price_cents });
  }
  return result;
}

const integrations = new Hono<{ Bindings: Env }>();
integrations.onError((error, c) => {
  if (error instanceof IntegrationError) return c.json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400);
  console.error('integration_failed', { name: error.name });
  return c.json({ error: 'Não foi possível concluir o teste. Confira o painel do provedor antes de repetir uma cobrança.' }, 500);
});
integrations.use('*', async (c, next) => {
  if (!['local', 'staging'].includes(c.env.APP_ENV)) return c.json({ error: 'Integrações disponíveis apenas em sandbox.' }, 503);
  if (!(await currentSession(c))) return c.json({ error: 'Entre na sua conta para testar.' }, 401);
  if (c.req.method === 'POST') {
    const token = getCookie(c, csrfCookie(c)) || '';
    if (c.req.header('Origin') !== c.env.APP_ORIGIN || !/^[a-f0-9]{64}$/.test(token) || !equal(token, c.req.header('X-CSRF-Token') || '')) return c.json({ error: 'Atualize a página e tente novamente.' }, 403);
    if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'Envie JSON.' }, 415);
  }
  await next();
});
integrations.get('/status', c => c.json({ sandbox: true,
  asaas: Boolean(c.env.ASAAS_API_KEY),
  melhorEnvio: Boolean(c.env.MELHOR_ENVIO_TOKEN && c.env.MELHOR_ENVIO_USER_AGENT && c.env.SHIPPING_ORIGIN_CEP),
}));
integrations.post('/shipping/quote', async c => {
  const parsed = z.object({ items: itemsSchema, cep: z.string().regex(/^\d{8}$/) }).strict().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Confira o CEP e os itens da sacola.' }, 400);
  const configured = await c.env.DB.prepare('SELECT data FROM store_settings WHERE id=1').first<{data:string}>();
  const settings = configured ? JSON.parse(configured.data) : {};
  const shippingEnv = { ...c.env,
    SHIPPING_ORIGIN_CEP: settings.shippingOriginCep || c.env.SHIPPING_ORIGIN_CEP,
    SHIPPING_ITEM_WEIGHT_KG: String(settings.shippingWeightKg ?? c.env.SHIPPING_ITEM_WEIGHT_KG ?? ''),
    SHIPPING_ITEM_WIDTH_CM: String(settings.shippingWidthCm ?? c.env.SHIPPING_ITEM_WIDTH_CM ?? ''),
    SHIPPING_ITEM_HEIGHT_CM: String(settings.shippingHeightCm ?? c.env.SHIPPING_ITEM_HEIGHT_CM ?? ''),
    SHIPPING_ITEM_LENGTH_CM: String(settings.shippingLengthCm ?? c.env.SHIPPING_ITEM_LENGTH_CM ?? ''),
  };
  const dimensions = shippingDimensions(shippingEnv);
  const items = await catalogItems(c.env, parsed.data.items);
  const sender = await c.env.DB.prepare('SELECT data FROM shipment_settings WHERE id=1').first<{data:string}>();
  if(sender) shippingEnv.SHIPPING_ORIGIN_CEP=JSON.parse(sender.data).postal_code;
  let dimensionsVerified = true;
  const products = [];
  for(const [n,item] of items.entries()) {
    const physical=await c.env.DB.prepare('SELECT data FROM sku_packages WHERE product_id=? AND color=? AND size=?').bind(item.id,item.color,item.size).first<{data:string}>();
    if(!physical) dimensionsVerified=false;
    products.push({id:String(n),...(physical?JSON.parse(physical.data):dimensions),quantity:item.qty,insurance_value:item.priceCents/100});
  }
  const quotes = await providerRequest<unknown>(c.env, 'shipping', '/me/shipment/calculate', {
    from: { postal_code: shippingEnv.SHIPPING_ORIGIN_CEP }, to: { postal_code: parsed.data.cep },
    products,
    options: { receipt: false, own_hand: false }, services: '1,2,3,4',
  });
  if (!Array.isArray(quotes)) throw new IntegrationError('Resposta de cotação inválida.');
  const rates = quotes.flatMap(q => {
    if (!q || typeof q !== 'object') return [];
    const price = Number(q.custom_price ?? q.price), days = Number(q.custom_delivery_time ?? q.delivery_time);
    return !q.error && Number.isFinite(price) && price > 0 && Number.isFinite(days) && days >= 0
      ? [{ id: String(q.id), name: String(q.name), company: String(q.company?.name || ''), priceCents: Math.round(price * 100), days, packages: q.packages || [], originCep: shippingEnv.SHIPPING_ORIGIN_CEP, dimensionsVerified }] : [];
  });
  const quoteId = crypto.randomUUID(), expiresAt = now() + 600;
  await c.env.DB.prepare('INSERT INTO sandbox_shipping_quotes(id,customer_id,cart_json,cep,rates_json,expires_at) VALUES (?,?,?,?,?,?)')
    .bind(quoteId,(await currentSession(c))!.customer.id,cartSnapshot(items),parsed.data.cep,JSON.stringify(rates),expiresAt).run();
  return c.json({ sandbox: true, quoteId, expiresAt, rates, subtotalCents: items.reduce((n,i) => n + i.priceCents * i.qty,0) });
});
integrations.post('/payments', async c => {
  const parsed = z.object({ items: itemsSchema, requestKey: z.string().uuid(), quoteId: z.string().uuid(), serviceId: z.string().min(1).max(20), billingType: z.enum(['PIX','BOLETO','CREDIT_CARD']), installments: z.number().int().min(1).max(3) }).strict().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Sacola ou identificador de teste inválido.' }, 400);
  const session = (await currentSession(c))!;
  if (!paymentChoiceSchema.safeParse(parsed.data).success) return c.json({ error: 'Parcelamento somente no crédito, em até 3 vezes. Pix e boleto são à vista.' }, 400);
  const requestJson = JSON.stringify(parsed.data);
  const previous = await c.env.DB.prepare('SELECT state,invoice_url,request_json,amount_cents FROM sandbox_payments WHERE customer_id=? AND request_key=?').bind(session.customer.id, parsed.data.requestKey).first<{ state: string; invoice_url: string | null; request_json: string | null; amount_cents: number }>();
  if (previous && previous.request_json !== requestJson) return c.json({ error: 'Tentativa já utilizada com outras opções de compra.' }, 409);
  if (previous?.state === 'created') return c.json({ sandbox: true, invoiceUrl: previous.invoice_url, amountCents: previous.amount_cents });
  if (previous) return c.json({ error: 'Teste já iniciado. Confira a cobrança no painel Asaas antes de repetir.' }, 409);
  if (!c.env.ASAAS_API_KEY) throw new IntegrationError('Configure ASAAS_API_KEY em .dev.vars.', 503);
  const profile = await c.env.DB.prepare('SELECT cpf FROM customer_profiles WHERE customer_id=?').bind(session.customer.id).first<{ cpf: string }>();
  if (!profile?.cpf) return c.json({ error: 'Preencha um CPF de teste válido em Minha conta antes de gerar a cobrança.' }, 400);
  const items = await catalogItems(c.env, parsed.data.items);
  const quote = await c.env.DB.prepare('SELECT cart_json,cep,rates_json,expires_at FROM sandbox_shipping_quotes WHERE id=? AND customer_id=?')
    .bind(parsed.data.quoteId,session.customer.id).first<{ cart_json: string; cep: string; rates_json: string; expires_at: number }>();
  if (!quote || quote.expires_at <= now() || quote.cart_json !== cartSnapshot(items)) return c.json({ error: 'Frete expirado ou sacola alterada. Consulte o frete novamente.' }, 409);
  const rates = JSON.parse(quote.rates_json) as { id: string; priceCents: number; company: string; name: string; days: number }[];
  const shipping = rates.find(r => r.id === parsed.data.serviceId);
  if (!shipping) return c.json({ error: 'Selecione um frete disponível.' }, 400);
  const amount = items.reduce((n, i) => n + i.priceCents * i.qty, 0) + shipping.priceCents;
  if (!amount) throw new IntegrationError('Subtotal inválido.', 400);
  const id = crypto.randomUUID();
  const lock = await c.env.DB.prepare('INSERT OR IGNORE INTO sandbox_payments(id,customer_id,request_key,amount_cents,created_at,request_json,shipping_json,billing_type,installments) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,session.customer.id,parsed.data.requestKey,amount,now(),requestJson,JSON.stringify({ ...shipping, cep: quote.cep }),parsed.data.billingType,parsed.data.installments).run();
  if (!lock.meta.changes) return c.json({ error: 'Teste já iniciado.' }, 409);
  // Never automatically retry a write after timeout: its outcome may be unknown.
  try {
    const customer = await providerRequest<{ id: string }>(c.env, 'asaas', '/customers', {
      name: session.customer.name, cpfCnpj: profile.cpf, notificationDisabled: true, externalReference: id,
    });
    if (typeof customer?.id !== 'string') throw new IntegrationError('Cliente não retornado pelo Asaas.');
    const payment = await providerRequest<{ id: string; invoiceUrl: string }>(c.env, 'asaas', '/payments', {
      customer: customer.id, billingType: parsed.data.billingType, ...paymentAmount(amount,parsed.data.installments),
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      description: `TESTE SANDBOX Mascavo: produtos + frete ${shipping.company} ${shipping.name}. Não é um pedido.`, externalReference: id,
    });
    if (typeof payment?.invoiceUrl !== 'string' || typeof payment?.id !== 'string') throw new IntegrationError('Resposta de cobrança inválida do Asaas. Confira o painel antes de repetir.');
    let url: URL;
    try { url = new URL(payment.invoiceUrl); }
    catch { throw new IntegrationError('Link de sandbox inválido. Confira o painel Asaas.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'sandbox.asaas.com' || typeof payment.id !== 'string') throw new IntegrationError('Link de sandbox inválido. Confira o painel Asaas.');
    await c.env.DB.prepare("UPDATE sandbox_payments SET state='created',provider_id=?,invoice_url=? WHERE id=?").bind(payment.id,url.href,id).run();
    return c.json({ sandbox: true, invoiceUrl: url.href, amountCents: amount }, 201);
  } catch (error) {
    await c.env.DB.prepare("UPDATE sandbox_payments SET state='review' WHERE id=?").bind(id).run();
    throw error;
  }
});
export default integrations;
