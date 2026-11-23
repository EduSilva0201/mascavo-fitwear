import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';

const origin = 'https://teste.mascavofit.com.br';
const asaas = 'https://api-sandbox.asaas.com';
const sqlValue = (value) => "'" + String(value).replaceAll("'", "''") + "'";

function database(sql) {
  try {
    const output = execFileSync(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'mascavo-staging',
      '--remote', '--config', 'wrangler.staging.jsonc', '--json', '--command', sql,
    ], { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(output);
    if (!result.every((entry) => entry.success)) throw new Error('D1 command failed');
    return result;
  } catch {
    throw new Error('Falha ao acessar o D1 de homologação. Confira a sessão do Wrangler.');
  }
}

async function jsonRequest(url, options, label) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(label + ' (HTTP ' + response.status + '). ' + (data?.error || 'Confira o painel do provedor.'));
  }
  return { response, data };
}

async function waitFor(label, check, timeout = 120000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    if (Date.now() < deadline) await delay(4000);
  } while (Date.now() < deadline);
  throw new Error(label + ' não foi confirmado. Consulte o pedido antes de repetir.');
}

function commercialSender(invoiceKey) {
  const source = process.env.MASCAVO_SANDBOX_SENDER_JSON;
  if (!source) throw new Error('Informe MASCAVO_SANDBOX_SENDER_JSON com os dados do remetente usados na NF-e de homologação.');
  let sender;
  try {
    sender = JSON.parse(source);
  } catch {
    throw new Error('MASCAVO_SANDBOX_SENDER_JSON deve conter um objeto JSON válido.');
  }
  const required = ['name', 'phone', 'email', 'company_document', 'state_register',
    'address', 'number', 'district', 'city', 'state_abbr', 'postal_code'];
  const allowed = [...required, 'complement'];
  if (!sender || Object.keys(sender).some((key) => !allowed.includes(key)) ||
      required.some((key) => typeof sender[key] !== 'string' || !sender[key].trim()) ||
      (sender.complement !== undefined && typeof sender.complement !== 'string') ||
      !/^\d{14}$/.test(sender.company_document) || !/^\d{10,11}$/.test(sender.phone) ||
      !/^\d{8}$/.test(sender.postal_code) || !/^[A-Z]{2}$/.test(sender.state_abbr) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender.email))
    throw new Error('Confira os dados completos do remetente de homologação, com CNPJ, inscrição estadual e CEP sem máscara.');
  if (sender.company_document !== invoiceKey.slice(6, 20))
    throw new Error('O CNPJ do remetente precisa corresponder ao CNPJ emissor da NF-e de teste.');
  return sender;
}

async function run(invoiceKey, senderConfig) {
  const access = JSON.parse(readFileSync('.wrangler/staging-access.json', 'utf8'));
  const apiKey = process.env.ASAAS_SANDBOX_API_KEY ||
    parseEnv(readFileSync('.dev.vars', 'utf8')).ASAAS_API_KEY;
  if (!apiKey?.startsWith('$aact_hmlg_')) throw new Error('Configure uma chave do Asaas Sandbox.');
  if (!access.STAGING_USERNAME || !access.STAGING_PASSWORD)
    throw new Error('Configure o acesso em .wrangler/staging-access.json.');
  const authorization = 'Basic ' + Buffer.from(access.STAGING_USERNAME + ':' + access.STAGING_PASSWORD).toString('base64');
  const { data: health } = await jsonRequest(origin + '/api/v1/health', { headers: { authorization } }, 'Health');
  if (health.environment !== 'staging' || health.checkout !== 'sandbox' || health.production !== false)
    throw new Error('O domínio não confirmou o ambiente de homologação Sandbox.');

  const [config, variant] = database(`
    SELECT EXISTS(SELECT 1 FROM shipment_settings) AS has_sender,
           EXISTS(SELECT 1 FROM integration_tokens WHERE provider='shipping') AS has_shipping;
    SELECT p.id,v.color,v.size FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id
    WHERE p.active=1 AND v.stock>0 ORDER BY p.id,v.color,v.size LIMIT 1;
  `).map((entry) => entry.results[0]);
  if (config.has_sender) throw new Error('O remetente já está configurado. Use um ambiente sem remetente para esta automação com dados fictícios.');
  if (!config.has_shipping || !variant) throw new Error('Autorize o Melhor Envio e disponibilize uma variante em estoque.');

  const customerId = randomUUID();
  const addressId = randomUUID();
  const requestKey = randomUUID();
  const sessionToken = randomBytes(32).toString('hex');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const customer = sqlValue(customerId);
  const item = { ...variant, qty: 1 };
  const sku = `${item.id},${sqlValue(item.color)},${sqlValue(item.size)}`;
  const skuFilter = `product_id=${item.id} AND color=${sqlValue(item.color)} AND size=${sqlValue(item.size)}`;
  const parcel = sqlValue(JSON.stringify({ weight: 0.3, width: 20, height: 4, length: 25 }));
  const sender = sqlValue(JSON.stringify(senderConfig ?? {
    name: 'Remetente Ficticio', email: customerId + '@example.test', phone: '61999999999',
    document: '11144477735', state_register: '', address: 'Rua Ficticia', number: '10',
    complement: '', district: 'Centro', city: 'Brasilia', state_abbr: 'DF', postal_code: '73060604',
  }));
  let insertedParcel = false;
  let orderId;

  try {
    const results = database(`
      INSERT OR IGNORE INTO shipment_settings VALUES (1,${sender});
      INSERT OR IGNORE INTO sku_packages SELECT ${sku},${parcel} WHERE EXISTS
        (SELECT 1 FROM shipment_settings WHERE id=1 AND data=${sender});
      INSERT INTO customers(id,name,email,password_hash,role,email_verified_at,created_at,updated_at)
        SELECT ${customer},'Cliente Ficticio',${sqlValue(customerId + '@example.test')},
          'disabled-fixture','admin',unixepoch(),unixepoch(),unixepoch() WHERE EXISTS
        (SELECT 1 FROM shipment_settings WHERE id=1 AND data=${sender});
    `);
    insertedParcel = Boolean(results[1].meta.changes);
    if (!results[2].meta.changes) throw new Error('Outro remetente foi configurado enquanto o teste iniciava.');
    database(`
      INSERT INTO customer_profiles VALUES (${customer},'52998224725','11999999999',unixepoch());
      INSERT INTO customer_addresses VALUES (${sqlValue(addressId)},${customer},'Teste','Cliente Ficticio',
        '04794000','Rua Ficticia','10','','Centro','Sao Paulo','SP',unixepoch());
      INSERT INTO sessions(token_hash,customer_id,created_at,last_seen_at,expires_at,idle_expires_at)
        VALUES (${sqlValue(sessionHash)},${customer},unixepoch(),unixepoch(),unixepoch()+1200,unixepoch()+1200);
    `);
    const csrf = await jsonRequest(origin + '/api/v1/auth/csrf', { headers: { authorization } }, 'Obter CSRF');
    const csrfCookie = csrf.response.headers.getSetCookie().find((value) => value.startsWith('__Host-mascavo-csrf='));
    if (!csrfCookie || !csrf.data.csrfToken) throw new Error('Cookie CSRF ausente.');
    const headers = {
      authorization, origin, cookie: csrfCookie.split(';')[0] + '; __Host-mascavo-session=' + sessionToken,
      'Content-Type': 'application/json', 'X-CSRF-Token': csrf.data.csrfToken,
    };
    const post = async (path, body, label) =>
      (await jsonRequest(origin + path, { method: 'POST', headers, body: JSON.stringify(body) }, label)).data;
    const quote = await post('/api/v1/integrations/shipping/quote', { items: [item], cep: '04794000' }, 'Cotar frete');
    const rates = quote.rates?.filter((choice) => choice.dimensionsVerified && choice.packages?.length === 1) ?? [];
    const rate = invoiceKey ? rates[0] : rates.find((choice) => choice.company === 'Jadlog') ?? rates[0];
    if (!rate) throw new Error('Nenhum serviço retornou um pacote único com medidas verificadas.');
    console.log('Frete cotado: ' + rate.company + ' ' + rate.name + '.');

    const order = await post('/api/v1/orders', {
      items: [item], addressId, requestKey, quoteId: quote.quoteId, serviceId: rate.id,
      billingType: 'PIX', installments: 1,
    }, 'Criar pedido Pix');
    orderId = order.orderId;
    console.log('Pedido de teste: ' + orderId);
    if (order.paymentState !== 'pending' || !order.invoiceUrl)
      throw new Error('A cobrança Pix ainda não está pronta. Consulte o pedido.');
    const [{ results: [payment] }] = database(
      `SELECT provider_id FROM orders WHERE id=${sqlValue(orderId)} AND customer_id=${customer} AND billing_type='PIX';`,
    );
    if (!/^pay_[a-z0-9_]+$/i.test(payment?.provider_id ?? '')) throw new Error('Cobrança Sandbox inválida.');
    const confirmation = await jsonRequest(asaas + '/v3/sandbox/payment/' + payment.provider_id + '/confirm', {
      method: 'POST',
      headers: { access_token: apiKey, 'User-Agent': 'Mascavo Fitwear Homologacao', 'Content-Type': 'application/json' },
      body: '{}',
    }, 'Simular Pix');
    if (confirmation.data.id !== payment.provider_id || !['RECEIVED', 'CONFIRMED'].includes(confirmation.data.status))
      throw new Error('O Asaas não confirmou a cobrança esperada.');
    await waitFor('Webhook do Pix', () => {
      const [{ results: [row] }] = database(`
        SELECT payment_state, EXISTS(SELECT 1 FROM sandbox_asaas_events
          WHERE payment_id=orders.provider_id AND event IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED')) AS received
        FROM orders WHERE id=${sqlValue(orderId)};
      `);
      return row?.payment_state === 'paid' && row.received;
    });
    console.log('Pix confirmado e webhook recebido.');

    const path = '/api/v1/orders/' + orderId;
    if (invoiceKey) await post(path + '/fiscal', { key: invoiceKey }, 'Vincular NF-e de teste');
    const shipmentPath = invoiceKey ? '/shipment' : '/shipment/test-content';
    const { shipment } = await post(path + shipmentPath, {}, 'Preparar expedição');
    const action = (name) => post(path + '/shipment/' + shipment.id + '/' + name, {}, 'Etiqueta: ' + name);
    console.log('Expedição de teste: ' + shipment.id);
    await action('cart');
    console.log('Envio adicionado ao carrinho.');
    const waitForState = async (result, states, label) => {
      if (states.includes(result.shipment.state)) return;
      console.log(label + ' solicitada. Aguardando confirmação do Melhor Envio.');
      await waitFor(label, async () => states.includes((await action('reconcile')).shipment.state), 360000);
    };
    const printableStates = ['generated', 'received', 'posted', 'delivered'];
    await waitForState(await action('purchase'), ['released', ...printableStates], 'Compra da etiqueta');
    console.log('Compra confirmada no Sandbox.');
    await waitForState(await action('generate'), printableStates, 'Geração da etiqueta');
    const printed = await action('print');
    const url = new URL(printed.shipment.print_url);
    if (url.origin !== 'https://sandbox.melhorenvio.com.br')
      throw new Error('Endereço de impressão fora do Sandbox.');
    console.log('Etiqueta gerada. Link de impressão Sandbox retornado pelo Melhor Envio.');
  } finally {
    try {
      database(`
      DELETE FROM sessions WHERE customer_id=${customer};
      UPDATE customers SET role='customer',status='disabled' WHERE id=${customer};
      DELETE FROM sandbox_shipping_quotes WHERE customer_id=${customer}
        AND NOT EXISTS(SELECT 1 FROM orders WHERE customer_id=${customer});
      DELETE FROM customers WHERE id=${customer}
        AND NOT EXISTS(SELECT 1 FROM orders WHERE customer_id=${customer});
      ${insertedParcel ? `DELETE FROM sku_packages WHERE ${skuFilter} AND data=${parcel};` : ''}
      DELETE FROM shipment_settings WHERE id=1 AND data=${sender};
      `);
    } catch (error) {
      console.error('Falha ao limpar os dados temporários do teste: ' + customerId);
      throw error;
    }
  }
}

const args = process.argv.slice(2);
const contentTest = args.length === 1 && args[0] === '--declaracao-conteudo';
const invoiceKey = contentTest ? '' : process.env.MASCAVO_SANDBOX_NFE_KEY ?? '';
try {
  if (args.length && !contentTest) throw new Error('Opção inválida. Use --declaracao-conteudo para o cenário sem NF-e.');
  if (!contentTest && (!/^\d{44}$/.test(invoiceKey) || invoiceKey.slice(20, 22) !== '55'))
    throw new Error('Informe MASCAVO_SANDBOX_NFE_KEY com a chave de 44 dígitos de uma NF-e modelo 55 emitida em homologação.');
  await run(invoiceKey, contentTest ? null : commercialSender(invoiceKey));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
