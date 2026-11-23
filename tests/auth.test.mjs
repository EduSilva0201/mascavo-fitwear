import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from './support/browser.mjs';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:8791';
const state = resolve('.wrangler', 'tests', crypto.randomUUID());
const env = {
  ...process.env,
  WRANGLER_LOG_PATH: resolve('.wrangler/test-logs'),
  WRANGLER_SEND_METRICS: 'false',
  CI: 'true',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
};
for (const key of Object.keys(env)) if (/ASAAS|MELHOR_ENVIO|RESEND|CLOUDFLARE_API|CF_API|AWS_|SMTP/.test(key)) delete env[key];
const cli = ['node_modules/wrangler/bin/wrangler.js','--config','tests/support/wrangler.test.jsonc'];
let server,
  database,
  output = '';
const password = 'Ficticia!Mascavo-2026';
const newPassword = 'Outra!Ficticia-2026';
const email = 'cliente@example.test';
const signupFields = { cpf: '52998224725', phone: '+55 (11) 99999-0000' };

class Client {
  cookies = new Map();
  csrf = '';
  async call(path, data, headers = {}) {
    const response = await fetch(origin + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.csrf,
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const type = response.headers.get('Content-Type') || '';
    const body = type.includes('application/json') ? await response.json() : await response.text();
    if (body.csrfToken) this.csrf = body.csrfToken;
    return { status: response.status, body, headers: response.headers };
  }
  async init() {
    await this.call('/api/v1/auth/csrf');
  }
  async auth(path, data, headers) {
    return this.call('/api/v1/auth/' + path, data, headers);
  }
}
const client = new Client();

before(async () => {
  const assets = spawnSync(process.execPath, ['scripts/prepare-assets.mjs'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(assets.status, 0, assets.stderr);
  const migration = spawnSync(
    process.execPath,
    [...cli, 'd1', 'migrations', 'apply', 'mascavo-tests-only', '--local', '--persist-to', state],
    { env, encoding: 'utf8' },
  );
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  server = spawn(
    process.execPath,
    [
      ...cli,
      'dev',
      '--local',
      '--port',
      '8791',
      '--var',
      `APP_ORIGIN:${origin}`,
      '--var',
      'MELHOR_ENVIO_ENABLED:true',
      '--persist-to',
      state,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stdout.on('data', (b) => {
    output += b;
  });
  server.stderr.on('data', (b) => {
    output += b;
  });
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(origin + '/api/v1/health');
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, output);
  const dir = resolve(state, 'v3/d1/miniflare-D1DatabaseObject');
  const file = readdirSync(dir).find((name) => name.endsWith('.sqlite'));
  assert.ok(file);
  database = new DatabaseSync(resolve(dir, file));
  await client.init();
});
after(() => {
  database?.close();
  server?.kill();
});

test('arquivos públicos preservados; fontes e configuração não são publicados', async () => {
  const page = await client.call('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /MASCAVO/);
  for (const path of ['/backend/src/index.ts', '/wrangler.jsonc', '/package.json', '/.dev.vars']) {
    assert.equal((await client.call(path)).status, 404);
  }
  const r = await client.auth('session');
  assert.equal(r.body.customer, null);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('bloqueia origem externa, CSRF ausente, JSON inválido e payload excessivo', async () => {
  assert.equal(
    (await client.auth('login', { email, password }, { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await client.auth('login', { email, password }, { 'X-CSRF-Token': '' })).status,
    403,
  );
  const r = await fetch(origin + '/api/v1/auth/login', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      'X-CSRF-Token': client.csrf,
      'Content-Type': 'application/json',
    },
    body: '{',
  });
  assert.equal(r.status, 400);
  assert.equal((await client.auth('login', { email, password: 'x'.repeat(9000) })).status, 413);
  assert.equal(
    (await client.auth('register', { name: 'Cliente Teste', email, password: 'curta' })).status,
    400,
  );
});
test('cadastro seguro, duplicidade genérica e confirmação de e-mail de uso único', async (t) => {
  const start = performance.now();
  const missingPhone = await client.auth('register', { name: 'Cliente Ficticio', email, password, cpf: signupFields.cpf });
  assert.equal(missingPhone.status, 400);
  const r = await client.auth('register', {
    name: 'Cliente Fictício',
    email: 'Cliente@Example.Test',
    password,
    ...signupFields,
  });
  t.diagnostic(
    `Cadastro com Argon2id no workerd local: ${Math.round(performance.now() - start)} ms (tempo total HTTP).`,
  );
  assert.equal(r.status, 202);
  const duplicate = await client.auth('register', { name: 'Outro Nome', email, password, ...signupFields });
  assert.deepEqual(duplicate.body, r.body);
  assert.equal(duplicate.status, 202);
  const row = database.prepare('SELECT * FROM customers WHERE email=?').get(email);
  assert.equal(row.role, 'customer');
  const savedProfile = database.prepare('SELECT cpf,phone FROM customer_profiles WHERE customer_id=?').get(row.id);
  assert.equal(savedProfile.cpf, signupFields.cpf);
  assert.equal(savedProfile.phone, '11999990000');
  assert.notEqual(row.password_hash, password);
  assert.match(row.password_hash, /^argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 1);
  const mail = (await client.call('/api/v1/dev/mail')).body.messages.find(
    (m) => m.purpose === 'verify',
  );
  assert.ok(mail.token);
  assert.equal(
    database.prepare('SELECT token_hash FROM auth_tokens').get().token_hash.includes(mail.token),
    false,
  );
  assert.equal((await client.auth('verify-email', { token: mail.token })).status, 200);
  assert.equal((await client.auth('verify-email', { token: mail.token })).status, 400);
  assert.equal((await new Client().call('/api/v1/dev/mail')).status, 403);
});
test('login, rotação CSRF, token de sessão com hash, logout e revogação', async (t) => {
  assert.equal((await client.auth('login', { email, password: 'senha-incorreta' })).status, 401);
  const csrfBefore = client.csrf,
    start = performance.now();
  const login = await client.auth('login', { email, password });
  t.diagnostic(
    `Login com Argon2id no workerd local: ${Math.round(performance.now() - start)} ms (tempo total HTTP).`,
  );
  assert.equal(login.status, 200);
  assert.notEqual(client.csrf, csrfBefore);
  const cookie = login.headers.getSetCookie().find((s) => s.startsWith('mascavo-session-local='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  const raw = client.cookies.get('mascavo-session-local');
  assert.equal(
    database.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash=?').get(raw).n,
    0,
  );
  assert.equal((await client.auth('session')).body.customer.emailVerified, true);
  assert.equal((await new Client().call('/api/v1/integrations/status')).status, 401);
  const integrationStatus = await client.call('/api/v1/integrations/status');
  assert.equal(integrationStatus.body.sandbox, true);
  assert.equal(JSON.stringify(integrationStatus.body).includes('API_KEY'), false);
  assert.equal((await client.call('/api/v1/integrations/payments', {}, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await client.call('/api/v1/integrations/payments', { items: [], requestKey: crypto.randomUUID() })).status, 400);
  const choice = { items: [{ id: 14, color: 'Preto', size: 'M', qty: 1 }], requestKey: crypto.randomUUID(), quoteId: crypto.randomUUID(), serviceId: '1', billingType: 'CREDIT_CARD', installments: 4 };
  assert.equal((await client.call('/api/v1/integrations/payments',choice)).status,400);
  assert.equal((await client.call('/api/v1/integrations/payments',{ ...choice, billingType: 'PIX', installments: 2 })).status,400);
  assert.equal((await client.call('/api/v1/integrations/shipping/quote', { items: [], cep: '123' })).status, 400);
  const stolen = new Client();
  stolen.cookies = new Map(client.cookies);
  assert.equal((await client.auth('logout', {})).status, 200);
  assert.equal((await stolen.auth('session')).body.customer, null);
});
test('expiração de sessão e checkout exige dados completos', async () => {
  assert.equal((await client.call('/api/v1/orders', {})).status, 401);
  assert.equal((await client.auth('login', { email, password })).status, 200);
  assert.equal((await client.call('/api/v1/orders', {})).status, 400);
  database.prepare('UPDATE sessions SET idle_expires_at=0 WHERE revoked_at IS NULL').run();
  assert.equal((await client.auth('session')).body.customer, null);
});
test('recuperação troca senha, invalida sessões e impede reutilização do token', async () => {
  assert.equal((await client.auth('login', { email, password })).status, 200);
  const existing = new Client();
  existing.cookies = new Map(client.cookies);
  const r = await client.auth('forgot-password', { email });
  assert.equal(r.status, 202);
  const absent = await client.auth('forgot-password', { email: 'nao-existe@example.test' });
  assert.deepEqual(absent.body, r.body);
  const mail = (await client.call('/api/v1/dev/mail')).body.messages.find(
    (m) => m.purpose === 'reset',
  );
  const reset = await client.auth('reset-password', { token: mail.token, password: newPassword });
  assert.equal(reset.status, 200);
  assert.equal((await existing.auth('session')).body.customer, null);
  assert.equal((await client.auth('reset-password', { token: mail.token, password })).status, 400);
  // Isolate this check from the previous account's intentional attempt counter.
  database.prepare('DELETE FROM auth_rate_limits').run();
  assert.equal((await client.auth('login', { email, password })).status, 401);
  assert.equal((await client.auth('login', { email, password: newPassword })).status, 200);
});
test('limita tentativas de uma conta em armazenamento compartilhado', async () => {
  let r;
  for (let i = 0; i < 11; i++)
    r = await client.auth('forgot-password', { email: 'limite@example.test' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('Retry-After'), '900');
});

test('navegador: vitrine, sacola, cadastro, login, sessão persistente e logout', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Tests remain offline apart from loopback; illustrations are not test dependencies.
    await page.route('https://images.unsplash.com/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="850"><rect width="700" height="850" fill="#73462D"/></svg>',
      }),
    );
    await page.goto(origin);
    await page.waitForSelector('.product');
    assert.equal(await page.locator('.product').count(), 6);
    await page.locator('[data-card-color="14"][data-color="Vinho"]').click();
    await page.locator('.product [data-open="14"]').first().click();
    await page.locator('#product-dialog [data-size="M"]').click();
    await page.locator('[data-add="14"]').click();
    assert.match(await page.locator('#cart-items').innerText(), /Vinho.*M/);
    assert.equal(await page.locator('[data-sandbox-payment]').isDisabled(), true);
    await page.locator('[data-qty="0"][data-delta="1"]').click();
    assert.equal(await page.locator('#count').innerText(), '2');
    await page.locator('#cart-dialog [data-close]').click();
    await page.locator('#account-toggle').click();
    await page.locator('[data-account-tab="register"]').click();
    await page.locator('[name="name"]').fill('Cliente Visual Fictício');
    await page.locator('[name="email"]').fill('visual@example.test');
    await page.locator('[name="cpf"]').fill(signupFields.cpf);
    await page.locator('[name="phone"]').fill(signupFields.phone);
    await page.locator('[name="password"]').fill(password);
    await page.locator('[name="confirm"]').fill(password);
    const registration = page.waitForResponse((r) => r.url().endsWith('/auth/register'));
    await page.locator('#account-submit').click();
    assert.equal((await registration).status(), 202);
    await page.waitForFunction(
      () => document.querySelector('#account-submit').textContent === 'Entrar',
    );
    await page.locator('[name="email"]').fill('visual@example.test');
    await page.locator('[name="password"]').fill(password);
    await page.locator('#account-submit').click();
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).waitFor();
    assert.match(await page.locator('#account-extra').innerText(), /Cliente Visual Fictício/);
    const verification = database.prepare("SELECT token FROM dev_mail WHERE recipient='visual@example.test' AND purpose='verify'").get();
    await page.goto(origin + '/?acesso=teste#mascavo-confirmar=' + verification.token);
    assert.equal(await page.getByLabel('Código do e-mail Confirme seu e-mail').inputValue(), verification.token);
    assert.equal(new URL(page.url()).hash, '');
    await page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
    await page.getByText(/Seu e-mail foi confirmado|E-mail confirmado/).first().waitFor();
    await page.reload();
    await page.locator('#account-toggle').click();
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    await page.locator('[name="email"]').waitFor();
    await page.locator('#account-dialog [data-close]').click();
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#menu-toggle').click();
    assert.equal(await page.locator('#mobile-menu').isVisible(), true);
    await page.locator('#mobile-menu [data-menu-filter="Leggings"]').click();
    assert.equal(await page.locator('.product').count(), 0);
    assert.equal(await page.locator('#catalog-empty').isVisible(), true);
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    // A tampered cart entry must not reach innerHTML.
    await page.evaluate(() =>
      localStorage.setItem(
        'mascavo-cart',
        JSON.stringify([{ id: 1, color: 'Cacau', qty: 1, size: '<img src=x onerror=alert(1)>' }]),
      ),
    );
    await page.reload();
    assert.equal(await page.locator('#count').innerText(), '0');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('catalog: seeded products, variants, filters and integer prices', async () => {
  const response = await client.call('/api/v1/catalog');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.products.map(p => p.id), [14, 13, 12, 11, 10, 9]);
  assert.ok(response.body.products.every(p => Number.isInteger(p.priceCents) && !p.provisional));
  assert.deepEqual(Object.fromEntries(response.body.products.map(p => [p.id, p.priceCents])), {9:16000,10:16000,11:15000,12:17000,13:17000,14:17000});
  const duo = response.body.products.find(p => p.id === 14);
  assert.deepEqual(duo.sizes, ['M']);
  assert.equal(duo.stock.Vinho.M, 5);
  assert.equal(duo.gallery.length, 5);
  const empty = await client.call('/api/v1/catalog?category=Leggings');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.products, []);
  const filtered = await client.call('/api/v1/catalog?category=Macaquinho');
  assert.deepEqual(filtered.body.products.map(p => p.id), [10]);
  const unknown = await client.call('/api/v1/catalog?category=unknown');
  assert.equal(unknown.status, 404);
  const injection = await client.call('/api/v1/catalog?category=' + encodeURIComponent("' OR 1=1 --"));
  assert.equal(injection.status, 404);
});

test('profile: validation, persistence, CSRF and address ownership', async () => {
 const anonymous = new Client();
 assert.equal((await anonymous.call('/api/v1/auth/profile')).status,401);
 const owner = new Client(), other = new Client();
 for (const [i, person] of [owner,other].entries()) {
  await person.init();
  const email = `profile-${i}@example.test`;
  assert.equal((await person.auth('register',{name:'Cliente Teste',email,password,...signupFields})).status,202);
  assert.equal((await person.auth('login',{email,password})).status,200);
 }
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',cpf:'11111111111',phone:''})).status,400);
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',cpf:'',phone:'11999990000'},{'X-CSRF-Token':'bad'})).status,403);
 await owner.init();
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',cpf:signupFields.cpf,phone:''})).status,400);
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',...signupFields})).status,200);
 const address = {label:'Casa teste',recipient:'Cliente Teste',cep:'01001000',street:'Rua Ficticia',number:'10',complement:'',neighborhood:'Centro',city:'Sao Paulo',state:'SP'};
 assert.equal((await owner.auth('profile/addresses',{...address,cep:'123'})).status,400);
 assert.equal((await owner.auth('profile/addresses',address)).status,200);
 const saved = (await owner.call('/api/v1/auth/profile')).body;
 assert.equal(saved.profile.name,'Cliente Atualizado');
 assert.equal(saved.profile.phone,'11999990000');
 assert.equal(saved.addresses.length,1);
 const id = saved.addresses[0].id;
 assert.equal((await other.call('/api/v1/auth/profile')).body.addresses.length,0);
 assert.equal((await other.auth('profile/addresses',{...address,id,label:'Invasao'})).status,404);
 assert.equal((await other.auth(`profile/addresses/${id}/delete`,{})).status,404);
 assert.equal((await owner.auth('profile/addresses',{...address,id,label:'Trabalho teste'})).status,200);
 assert.equal((await owner.call('/api/v1/auth/profile')).body.addresses[0].label,'Trabalho teste');
 assert.equal((await owner.auth(`profile/addresses/${id}/delete`,{})).status,200);
 assert.equal((await owner.call('/api/v1/auth/profile')).body.addresses.length,0);
});

test('rail: side profiles, hover turn, closed-back views and mobile layout', async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);
  await page.waitForSelector('[data-garment]');
  assert.equal(await page.locator('[data-garment]').count(),3);
  assert.equal(await page.locator('.product').count(),6);
  const rail=page.locator('[data-slot="clothing-rail-hero"]');
  assert.equal(await rail.getAttribute('data-active'),'');
  assert.equal(await page.locator('[data-face="side"] img').count(),3);
  const first=page.locator('[data-garment="0"]');
  await first.hover();
  await page.waitForFunction(()=>document.querySelector('[data-slot="clothing-rail-hero"]').dataset.active==='0');
  await page.mouse.move(1,1);
  await page.waitForFunction(()=>document.querySelector('[data-slot="clothing-rail-hero"]').dataset.active==='');
  await first.focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('.rail-dialog');
  assert.equal(await page.locator('.rail-dialog h3').textContent(),'Mix \u00b7 Preto');
  assert.equal(await page.locator('.rail-shop-link').count(),0);
  await page.getByRole('button',{name:'Costas',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Costas',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('header.navbar').evaluate(el=>!!el.closest('[inert]')),true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rail-dialog',{state:'detached'});
  assert.equal(await page.locator('header.navbar').evaluate(el=>!!el.closest('[inert]')),false);
  await page.setViewportSize({width:390,height:844});
  await first.focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('.rail-dialog');
  assert.ok(await page.locator('[data-rail-detail-stage]').evaluate(el=>el.getBoundingClientRect().top>=0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rail-dialog',{state:'detached'});
  assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});

test('sandbox: sacola mostra testes e exige login antes de consultar provedores', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.evaluate(() => localStorage.setItem('mascavo-cart', JSON.stringify([{ id: 14, color: 'Preto', size: 'M', qty: 1 }])));
    await page.reload();
    await page.waitForSelector('.product');
    await page.locator('#cart-toggle').click();
    await page.locator('[name="sandbox-cep"]').fill('01001-000');
    await page.locator('[data-sandbox-quote]').click();
    await page.waitForFunction(() => document.querySelector('.sandbox-tests [role="status"]').textContent.includes('Entre na sua conta'));
    assert.equal(await page.locator('#cart-summary > .primary').isDisabled(), true);
    assert.equal(await page.locator('[data-sandbox-quote]').isEnabled(), true);
    const feedback = page.locator('.sandbox-tests [role="status"]');
    assert.equal(await feedback.getAttribute('data-kind'), 'error');
    assert.equal(await feedback.evaluate(el => getComputedStyle(el).fontSize), '15px');
  } finally { await browser.close(); }
});

test('checkout: seleciona frete, soma total e envia crédito em até 3x', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    let submitted;
    const invoiceUrl = 'https://sandbox.asaas.com/i/test';
    await page.route(invoiceUrl, route => route.fulfill({ body: 'Pagamento Asaas' }));
    await page.route('**/api/v1/integrations/shipping/quote', route => route.fulfill({ json: { quoteId: '11111111-1111-4111-8111-111111111111', expiresAt: Math.floor(Date.now()/1000)+600, subtotalCents: 17000, rates: [{ id: '1', name: 'PAC', company: 'Correios', priceCents: 2206, days: 5 },{ id: '2', name: 'SEDEX', company: 'Correios', priceCents: 4183, days: 2 }] } }));
    await page.route('**/api/v1/auth/profile', route => route.fulfill({json:{profile:signupFields,addresses:[{id:'22222222-2222-4222-8222-222222222222',label:'Casa',street:'Rua Teste',number:'1',cep:'04794000'}]}}));
    await page.route('**/api/v1/orders', route => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { orderId:'33333333-3333-4333-8333-333333333333',invoiceUrl, amountCents: 19206 } }); });
    await page.goto(origin);
    await page.evaluate(() => localStorage.setItem('mascavo-cart',JSON.stringify([{ id:14, color:'Preto',size:'M',qty:1 }])));
    await page.reload(); await page.waitForSelector('.product'); await page.locator('#cart-toggle').click();
    assert.equal(await page.locator('[data-sandbox-payment]').isDisabled(),true);
    await page.locator('[name="order-address"]').selectOption('22222222-2222-4222-8222-222222222222');
    await page.locator('[name="sandbox-cep"]').fill('04794-000'); await page.locator('[data-sandbox-quote]').click();
    await page.locator('[name="shipping-service"][value="1"]').check();
    assert.match(await page.locator('.checkout-total').innerText(),/192,06/);
    await page.locator('[name="billing-type"]').selectOption('CREDIT_CARD');
    assert.equal(await page.locator('[name="installments"] option').count(),3);
    await page.locator('[name="billing-type"]').selectOption('PIX');
    assert.equal(await page.locator('[name="installments"]').inputValue(),'1');
    await page.locator('[name="sandbox-cep"]').fill('01001000');
    assert.equal(await page.locator('[data-sandbox-payment]').isDisabled(),true);
    await page.locator('[name="sandbox-cep"]').fill('04794000');
    await page.locator('[data-sandbox-quote]').click();
    await page.locator('[name="shipping-service"][value="1"]').check();
    await page.locator('[name="billing-type"]').selectOption('CREDIT_CARD');
    await page.locator('[name="installments"]').selectOption('3');
    await Promise.all([
      page.waitForURL(invoiceUrl),
      page.locator('[data-sandbox-payment]').click(),
    ]);
    assert.equal(submitted.billingType,'CREDIT_CARD'); assert.equal(submitted.installments,3); assert.equal(submitted.serviceId,'1');
    assert.equal('amountCents' in submitted,false);
  } finally { await browser.close(); }
});

test('checkout: opens Asaas automatically without a shipping quote when the invoice is ready', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const invoiceUrl = 'https://sandbox.asaas.com/i/checkout';
    const orderId = '33333333-3333-4333-8333-333333333333';
    const addressId = '22222222-2222-4222-8222-222222222222';
    const attempts = [];
    await page.route('**/api/v1/health', route => route.fulfill({ json: { integratedShipping: false } }));
    await page.route('**/api/v1/store', route => route.fulfill({
      json: { settings: { deliveryPolicy: 'Consulte a disponibilidade para seu bairro.', whatsapp: '11987654321' } },
    }));
    await page.route('**/api/v1/auth/profile', route => route.fulfill({ json: { profile: signupFields, addresses: [{ id: addressId, label: 'Casa', street: 'Rua Teste', number: '1', cep: '04794000' }] } }));
    await page.route(invoiceUrl, route => route.fulfill({ body: 'Pagamento Asaas' }));
    await page.route('**/api/v1/orders', route => {
      attempts.push(route.request().postDataJSON());
      return attempts.length === 1
        ? route.fulfill({ status: 202, json: { orderId, invoiceUrl: null } })
        : route.fulfill({ status: 201, json: { orderId, invoiceUrl } });
    });
    await page.goto(origin);
    await page.evaluate(() => localStorage.setItem('mascavo-cart', JSON.stringify([{ id: 14, color: 'Preto', size: 'M', qty: 1 }])));
    await page.reload();
    await page.locator('.product').first().waitFor();
    assert.equal(await page.locator('.footer-trust').getByText('Entrega pela loja', { exact: true }).count(), 1);
    await page.locator('#cart-toggle').click();
    await page.locator('#checkout-address-hint').waitFor();
    await page.locator('.sandbox-tests').getByText(/^Entrega pela loja\./).waitFor();
    await page.locator('.sandbox-tests').getByText('Consulte a disponibilidade para seu bairro.').waitFor();
    assert.equal(await page.locator('.sandbox-tests').getByRole('link', { name: /WhatsApp/ }).getAttribute('href'), 'https://wa.me/5511987654321');
    await page.locator('[name="order-address"]').selectOption(addressId);
    assert.equal(await page.locator('#checkout-address-hint').isHidden(), true);
    const pay = page.locator('[data-sandbox-payment]');
    assert.equal(await page.locator('[data-sandbox-quote]').isHidden(), true);
    await pay.click();
    await page.getByText(/aguardando revis.o da cobran.a/).waitFor();
    assert.equal(new URL(page.url()).origin, origin);
    await Promise.all([page.waitForURL(invoiceUrl), pay.click()]);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal('quoteId' in attempts[0], false);
  } finally { await browser.close(); }
});

test('checkout: production shows delivery and total before opening the live Asaas invoice', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const addressId = '22222222-2222-4222-8222-222222222222';
    const invoiceUrl = 'https://www.asaas.com/i/fixture';
    let checkout = 'closed';
    let submitted;
    await page.route('**/api/v1/health', route => route.fulfill({ json: {
      checkout, production: true, integratedShipping: false, paymentMethods: ['PIX'],
      delivery: { feeCents: 1500, cepPrefixes: ['047'], estimate: 'Até 3 dias úteis' },
    } }));
    await page.route('**/api/v1/auth/profile', route => route.fulfill({ json: { profile: signupFields, addresses: [
      { id: addressId, label: 'Casa', street: 'Rua Teste', number: '1', cep: '04794000' },
    ] } }));
    await page.route('**/api/v1/orders', route => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { invoiceUrl } });
    });
    await page.route(invoiceUrl, route => route.fulfill({ body: 'Pagamento simulado' }));
    await page.goto(origin);
    await page.evaluate(() => localStorage.setItem('mascavo-cart', JSON.stringify([{ id: 14, color: 'Preto', size: 'M', qty: 1 }])));
    await page.reload();
    await page.locator('.product').first().waitFor();
    await page.locator('#cart-toggle').click();
    await page.getByText('As vendas online ainda não estão abertas.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continuar para pagamento' }).count(), 0);
    checkout = 'live';
    await page.reload();
    await page.locator('.product').first().waitFor();
    await page.locator('#cart-toggle').click();
    await page.locator('[name="order-address"]').selectOption(addressId);
    await page.getByText(/Prazo estimado.*3 dias úteis/).waitFor();
    assert.match(await page.locator('.checkout-total').innerText(), /15,00.*Total a pagar/);
    assert.deepEqual(await page.locator('[name="billing-type"] option').allTextContents(), ['Pix']);
    await Promise.all([page.waitForURL(invoiceUrl), page.getByRole('button', { name: 'Continuar para pagamento' }).click()]);
    assert.equal(submitted.billingType, 'PIX');
    assert.ok(submitted.expectedAmountCents > 1500);
  } finally { await browser.close(); }
});

test('modern dialogs: login, senha visível, cadastro e sacola responsivos', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto(origin); await page.waitForSelector('.product');
    await page.locator('#account-toggle').click();
    await page.locator('.signin-card').waitFor();
    await page.locator('#account-submit').click();
    const feedback = page.locator('#account-feedback');
    await feedback.waitFor();
    assert.equal(await feedback.innerText(), 'Preencha o campo E-mail.');
    assert.equal(await feedback.evaluate(el => getComputedStyle(el).fontSize), '15px');
    assert.equal(await page.locator('#account-fields input[name="email"]').getAttribute('aria-invalid'), 'true');
    await page.locator('#account-fields input[name="email"]').fill('cliente@example.test');
    await page.locator('#account-fields input[name="password"]').fill('SenhaTeste123!');
    await page.locator('.password-toggle').click();
    assert.equal(await page.locator('#account-fields input[name="password"]').getAttribute('type'),'text');
    await mkdir('test-results',{recursive:true});
    await page.screenshot({path:'test-results/modern-login-desktop.png'});
    await page.locator('[data-account-tab="register"]').click();
    assert.equal(await page.locator('#account-fields input').count(),6);
    await page.locator('[data-account-tab="login"]').click();
    await page.setViewportSize({width:390,height:844});
    const bounds=await page.locator('#account-dialog').boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=391);
    await page.screenshot({path:'test-results/modern-login-mobile.png'});
    await page.locator('#account-dialog [data-close]').click();
    await page.evaluate(()=>localStorage.setItem('mascavo-cart',JSON.stringify([{id:14,color:'Preto',size:'M',qty:1}])));
    await page.reload();await page.waitForSelector('.product');await page.locator('#cart-toggle').click();
    await page.locator('[name="billing-type"]').selectOption('CREDIT_CARD');
    await page.locator('#cart-dialog').evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
    const bag=await page.locator('#cart-dialog').boundingBox();
    assert.ok(bag.x>=0 && bag.x+bag.width<=391);
    await page.screenshot({path:'test-results/modern-bag-mobile.png'});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('admin: autoriza por papel, gerencia produto, estoque, imagens e configuracoes', async () => {
  const staff=new Client();await staff.init();
  const staffEmail='admin@example.test';
  assert.equal((await staff.auth('register',{name:'Gestora Teste',email:staffEmail,password,...signupFields})).status,202);
  database.prepare('UPDATE customers SET email_verified_at=? WHERE email=?').run(Math.floor(Date.now()/1000),staffEmail);
  assert.equal((await staff.auth('login',{email:staffEmail,password})).status,200);
  assert.equal((await staff.call('/api/v1/admin/catalog')).status,403);
  database.prepare("UPDATE customers SET role='admin' WHERE email=?").run(staffEmail);
  assert.equal((await staff.call('/api/v1/admin/session')).status,200);
  assert.equal((await new Client().call('/api/v1/admin/catalog')).status,401);
  const catalog=await staff.call('/api/v1/admin/catalog');assert.equal(catalog.status,200);
  const original=catalog.body.products[0];
  const body={name:'Produto Admin Teste',category:original.category,description:'Descricao de teste',price_cents:12345,active:true,provisional:false,sort_order:99,variants:[{color:'Preto',size:'M',stock:1,image_url:original.variants[0].image_url}],images:[{src:original.images[0].src,label:'Frente',color:'Preto'}]};
  assert.equal((await staff.call('/api/v1/admin/products/new',body,{'X-CSRF-Token':''})).status,403);
  assert.equal((await staff.call('/api/v1/admin/products/new',{...body,name:'<script>bad</script>'})).status,400);
  const saved=await staff.call('/api/v1/admin/products/new',body);assert.equal(saved.status,200);
  const id=saved.body.id;
  const publicProduct=(await staff.call('/api/v1/catalog')).body.products.find(p=>p.id===id);
  assert.equal(publicProduct.priceCents,12345);assert.equal(publicProduct.stock.Preto.M,1);
  assert.equal((await staff.call('/api/v1/admin/products/'+id,{...body,revision:'stale'})).status,409);
  assert.equal(database.prepare('SELECT stock FROM catalog_variants WHERE product_id=?').get(id).stock,1);
  const changed=await staff.call('/api/v1/admin/products/'+id,{...body,revision:saved.body.revision,active:false,variants:[{...body.variants[0],stock:0}]});assert.equal(changed.status,200);
  assert.equal((await staff.call('/api/v1/catalog')).body.products.some(p=>p.id===id),false);
  assert.equal((await staff.call('/api/v1/admin/categories',{name:'Novidades'})).status,200);
  assert.equal((await staff.call('/api/v1/admin/categories/manage',{name:'Novidades',action:'rename',newName:'Lancamentos'})).status,200);
  assert.equal((await staff.call('/api/v1/admin/categories/manage',{name:original.category,action:'delete'})).status,409);
  assert.equal((await staff.call('/api/v1/admin/categories/manage',{name:'Lancamentos',action:'delete'})).status,200);
  const settings=(await staff.call('/api/v1/admin/settings')).body;
  const settingsData={storeName:'Mascavo Teste',tagline:'Seu movimento',contactEmail:'',whatsapp:'',instagram:'',announcement:'Colecao de teste'};
  assert.equal((await staff.call('/api/v1/admin/settings',{data:settingsData,revision:settings.revision})).status,200);
  assert.equal((await staff.call('/api/v1/admin/settings',{data:settingsData,revision:settings.revision})).status,409);
  assert.equal((await staff.call('/api/v1/store')).body.settings.storeName,'Mascavo Teste');
  const cookies=[...staff.cookies].map(([k,v])=>k+'='+v).join('; ');
  const png=readFileSync('assets/brand/mascavo-logo.png');
  const upload=await fetch(origin+'/api/v1/admin/media',{method:'POST',headers:{Cookie:cookies,Origin:origin,'X-CSRF-Token':staff.csrf,'Content-Type':'image/png'},body:png});
  assert.equal(upload.status,201);const media=await upload.json();
  const photo=await fetch(origin+media.src);assert.equal(photo.status,200);assert.equal(photo.headers.get('Content-Type'),'image/png');assert.equal((await photo.arrayBuffer()).byteLength,png.byteLength);
  const invalid=await fetch(origin+'/api/v1/admin/media',{method:'POST',headers:{Cookie:cookies,Origin:origin,'X-CSRF-Token':staff.csrf,'Content-Type':'image/png'},body:'<script>not an image</script>'});assert.equal(invalid.status,400);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addCookies([...staff.cookies].map(([name,value])=>({name,value,url:origin})));
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/admin');await page.locator('#admin-shell:not([hidden])').waitFor();
    await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/admin-overview.png'});
    await page.locator('.sidebar [data-page="sales"]').click();
    await page.getByText('Nenhum pedido foi criado neste período.').waitFor();
    await page.route('**/sales-report?days=7', async route => {
      const response = await route.fetch();
      const report = await response.json();
      report.sales = [
        { day: report.dates[0], method: 'PIX', state: 'paid', orders: 2, amountCents: 24680 },
        { day: report.dates[0], method: 'PIX', state: 'pending', orders: 1, amountCents: 9900 },
      ];
      report.products = [{ id: 14, name: 'Produto de teste', units: 2 }];
      await route.fulfill({ response, json: report });
    });
    const reportRequest = page.waitForResponse(response => response.url().endsWith('/sales-report?days=7'));
    await page.getByLabel('Período').selectOption('7');
    assert.equal((await reportRequest).status(), 200);
    await page.getByText('Produto de teste', { exact: true }).waitFor();
    assert.match(await page.locator('.sales-revenue dd').innerText(), /246,80/);
    assert.equal(await page.locator('.sales-bars > div').count(), 7);
    await page.getByText('Ver dados por dia', { exact: true }).click();
    assert.match(await page.locator('.sales-table tbody tr').first().innerText(), /246,80/);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^mascavo-vendas-.*\.csv$/);
    assert.match(readFileSync(await download.path(), 'utf8'), /;3;2;246,80/);
    await page.locator('.sidebar [data-page="products"]').click();await page.locator('[data-edit]').first().click();
    await page.locator('#editor[open]').waitFor();await page.locator('[name="name"]').fill('Edicao sem salvar');
    await page.locator('#editor [data-close]').first().click();await page.locator('#confirm-dialog[open]').waitFor();await page.locator('#keep-editing').click();
    assert.equal(await page.locator('[name="name"]').inputValue(),'Edicao sem salvar');
    await page.screenshot({path:'test-results/admin-editor.png'});
    await page.locator('#editor [data-close]').first().click();await page.locator('#discard-editing').click();
    await page.locator('.sidebar [data-page="settings"]').click();
    await page.locator('[name="shippingOriginCep"]').fill('73060604');
    await page.locator('[name="shippingWeightKg"]').fill('0.3');
    await page.locator('[name="orderWhatsAppMessage"]').fill('Olá, {nome}! Seu pedido é {pedido}.');
    await page.locator('#settings-form button').click();
    await page.waitForFunction(()=>document.querySelector('#notification').textContent.includes('aplicadas'));
    assert.equal((await staff.call('/api/v1/store')).body.settings.shippingOriginCep,'73060604');
    assert.equal('orderWhatsAppMessage' in (await staff.call('/api/v1/store')).body.settings, false);
    const orderId = '33333333-3333-4333-8333-333333333333';
    await page.route('**/orders/manage', route => route.fulfill({ json: { orders: [{
      id: orderId, amount_cents: 16000, payment_state: 'paid', reservation_state: 'active',
    }] } }));
    await page.route('**/orders/' + orderId, route => route.fulfill({ json: { order: {
      contactPhone: '11999990000',
      paymentState: 'paid',
      snapshot: { customer: { name: 'Cliente Teste' }, address: { recipient: 'Cliente Teste', street: 'Rua Teste', number: '1', cep: '04794000' }, items: [] },
    }, shipments: [] } }));
    await page.locator('.sidebar [data-page="orders"]').click();
    await page.locator('#commerce-orders').waitFor();
    await page.getByRole('button', { name: 'Abrir pedido' }).click();
    const whatsapp = new URL(await page.getByRole('link', { name: 'Conversar no WhatsApp' }).getAttribute('href'));
    assert.equal(whatsapp.origin + whatsapp.pathname, 'https://wa.me/5511999990000');
    assert.equal(whatsapp.searchParams.get('text'), 'Olá, Cliente Teste! Seu pedido é 33333333.');
    await page.locator('.sidebar [data-page="fulfillment"]').click();
    await page.locator('#sender-form').waitFor();
    for (const [key,value] of Object.entries({name:'Mascavo Teste',company_document:'12345678000195',state_register:'123456789',phone:'61999999999',email:'loja@example.test',postal_code:'73060604',address:'Rua Teste',number:'1',district:'Centro',city:'Brasilia',state_abbr:'DF'}))
      await page.locator('#sender-form [name="'+key+'"]').fill(value);
    await page.locator('#sender-form button').click();
    await page.waitForFunction(()=>document.querySelector('#notification').textContent==='Remetente salvo.');
    for (const [key,value] of Object.entries({weight:'0.3',width:'20',height:'4',length:'25'})) await page.locator('#package-form [name="'+key+'"]').fill(value);
    await page.locator('#package-form button').click();
    await page.waitForFunction(()=>document.querySelector('#notification').textContent.includes('Peso e medidas salvos'));
    await page.screenshot({path:'test-results/admin-fulfillment.png'});
    await page.locator('.sidebar [data-page="order-mail"]').click();
    await page.getByRole('heading',{name:'E-mails de teste',exact:true}).waitFor();
    await page.locator('.sidebar [data-page="products"]').click();
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/admin-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
  database.prepare("UPDATE customers SET role='customer' WHERE email=?").run(staffEmail);
  assert.equal((await staff.call('/api/v1/admin/catalog')).status,403);
});

test('preloader: initial entry, reload, mobile, image failures, reduced motion and fail-safe', async t => {
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    await t.test('first visit measures real resources and blocks hidden controls',async()=>{
      const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      let release;const hold=new Promise(resolve=>release=resolve);
      await page.route('**/assets/campaign/movimento-logo.jpg',async route=>{await hold;await route.continue().catch(()=>{});});
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('.preloader-track')?.getAttribute('aria-valuenow')==='2');
      assert.equal(await page.locator('#storefront').evaluate(el=>el.inert),true);
      assert.equal(await page.locator('#preloader').isVisible(),true);
      assert.equal(await page.locator('.preloader-track').getAttribute('aria-valuemax'),'3');
      await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/preloader-desktop.png'});
      release();await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'));
      assert.equal(await page.locator('#storefront').evaluate(el=>el.inert),false);
      assert.equal(await page.locator('.campaign-slide.is-active').isVisible(),true);
      await page.reload({waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('preloader-active')),false);
      // Returning from another same-tab page also skips the entrance.
      await page.goto(origin+'/admin',{waitUntil:'domcontentloaded'});await page.goto(origin,{waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('preloader-active')),false);
      assert.deepEqual(errors,[]);await context.close();
    });
    await t.test('mobile: keyboard can skip without entering hidden content',async()=>{
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
      await page.route('**/assets/campaign/movimento-logo.jpg',()=>{});
      await page.goto(origin,{waitUntil:'domcontentloaded'});await page.keyboard.press('Tab');
      assert.equal(await page.locator('#preloader-skip').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:'test-results/preloader-mobile.png'});
      await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'));
      assert.equal(await page.locator('.brand-image').evaluate(el=>el===document.activeElement),true);
      await context.close();
    });
    await t.test('broken logo and hero do not prevent revealing the page',async()=>{
      const context=await browser.newContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/assets/brand/mascavo-logo.png',route=>route.abort('failed'));
      await page.route('**/assets/campaign/movimento-logo.jpg',route=>route.abort('failed'));
      await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'));
      assert.equal(await page.locator('#storefront').evaluate(el=>el.inert),false);assert.deepEqual(errors,[]);await context.close();
    });
    await t.test('watchdog unlocks the site if the preloader script never loads',async()=>{
      const context=await browser.newContext(),page=await context.newPage();
      await page.route('**/preloader.js',route=>route.abort('failed'));
      const started=Date.now();await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'),{},{timeout:6000});
      assert.ok(Date.now()-started<6000);assert.equal(await page.locator('#storefront').evaluate(el=>el.inert),false);await context.close();
    });
    await t.test('reduced motion removes entrance and exit animations',async()=>{
      const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:768,height:1024}}),page=await context.newPage();
      let release;const hold=new Promise(resolve=>release=resolve);
      await page.route('**/assets/campaign/movimento-logo.jpg',async route=>{await hold;await route.continue().catch(()=>{});});
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('.preloader-brand').evaluate(el=>getComputedStyle(el).animationName),'none');
      assert.equal(await page.locator('#preloader').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      release();await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'));await context.close();
    });
    await t.test('unavailable storage does not break the page',async()=>{
      const context=await browser.newContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Storage unavailable','SecurityError');}}));
      await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'));
      assert.equal(await page.locator('#storefront').evaluate(el=>el.inert),false);assert.deepEqual(errors,[]);await context.close();
    });
    await t.test('product images do not block entry and the hero slider still advances',async()=>{
      const context=await browser.newContext(),page=await context.newPage();
      await page.route('**/assets/products/**',()=>{});
      const started=Date.now();await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!document.documentElement.classList.contains('preloader-active'));
      assert.ok(Date.now()-started<3500);
      await page.waitForFunction(()=>document.querySelectorAll('.campaign-slide')[1].classList.contains('is-active'),{},{timeout:6500});
      await context.close();
    });
    await t.test('JavaScript disabled leaves content visible and accessible',async()=>{
      const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();await page.goto(origin);
      assert.equal(await page.locator('#preloader').isVisible(),false);assert.equal(await page.locator('.campaign-slide.is-active').isVisible(),true);
      assert.equal(await page.locator('#storefront').evaluate(el=>el.hasAttribute('inert')),false);await context.close();
    });
  }finally{await browser.close();}
});

test('editorial: admin publica depoimentos e FAQ com visual acessivel na loja',async()=>{
  const staff=new Client();await staff.init();const staffEmail='editorial@example.test';
  assert.equal((await staff.auth('register',{name:'Editora Teste',email:staffEmail,password,...signupFields})).status,202);
  database.prepare("UPDATE customers SET role='admin',email_verified_at=? WHERE email=?").run(Math.floor(Date.now()/1000),staffEmail);
  assert.equal((await staff.auth('login',{email:staffEmail,password})).status,200);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addCookies([...staff.cookies].map(([name,value])=>({name,value,url:origin})));
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/admin');await page.locator('#admin-shell:not([hidden])').waitFor();
    await page.locator('.sidebar [data-page="testimonials"]').click();await page.locator('#new-content').click();
    await page.locator('#content-fields [name="author_name"]').fill('Cliente de teste');
    await page.locator('#content-fields [name="author_detail"]').fill('Depoimento ficticio apenas no teste');
    await page.locator('#content-fields [name="quote"]').fill('Conforto e liberdade em cada movimento.');
    await page.locator('#content-fields [name="rating"]').selectOption('5');
    await page.locator('#content-save').click();await page.locator('#content-editor').waitFor({state:'hidden'});
    let data=(await staff.call('/api/v1/content')).body;assert.equal(data.testimonials.length,0);
    await page.locator('[data-content-edit]').first().click();await page.locator('#content-fields [name="published"]').check();
    await page.locator('#content-save').click();await page.locator('#content-editor').waitFor({state:'hidden'});
    data=(await staff.call('/api/v1/content')).body;assert.equal(data.testimonials.length,1);
    assert.equal((await staff.call('/api/v1/admin/content/testimonials/new',{author_name:'Outra cliente de teste',author_detail:'Exemplo somente no teste',quote:'Uma experiencia feita de cuidado e detalhes.',avatar_url:'',rating:null,published:true,sort_order:1})).status,200);
    await page.screenshot({path:'test-results/admin-testimonials.png'});
    await page.goto(origin);await page.locator('#testimonials-root .testimonial-card').first().waitFor();
    assert.equal(await page.locator('.shop-nav a[href="#depoimentos"]').isVisible(),true);
    await page.locator('#depoimentos').scrollIntoViewIfNeeded();await page.locator('.testimonial-pause').click();
    assert.equal(await page.locator('.testimonial-pause').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.testimonials-track').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    assert.equal(await page.locator('.testimonials-copy').getAttribute('aria-hidden'),'true');
    await page.locator('#depoimentos').screenshot({path:'test-results/testimonials-desktop.png'});
    await page.goto(origin+'/admin');await page.locator('.sidebar [data-page="faq"]').click();await page.locator('#new-content').click();
    await page.locator('#content-fields [name="question"]').fill('Como cuidar da peca de teste?');
    await page.locator('#content-fields [name="answer"]').fill('Confira a etiqueta da peca.\nSiga as instrucoes do fabricante.');
    await page.locator('#content-fields [name="category"]').fill('Cuidados');await page.locator('#content-fields [name="published"]').check();
    await page.locator('#content-save').click();await page.locator('#content-editor').waitFor({state:'hidden'});
    await page.goto(origin+'/duvidas-frequentes');await page.locator('#faq-list details').first().waitFor();
    assert.equal(await page.locator('#faq-retry').isVisible(),false);
    await page.getByText('Como funciona a entrega?', { exact: true }).click();
    assert.match(await page.locator('#faq-list details[open] .faq-answer').innerText(), /^Entrega pela loja\./);
    await page.locator('#faq-search').fill('cuidar');assert.equal(await page.locator('#faq-list details').count(),1);
    await page.locator('#faq-list summary').click();assert.match(await page.locator('.faq-answer').innerText(),/fabricante/);
    await page.screenshot({path:'test-results/faq-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'test-results/faq-mobile.png',fullPage:true});
    await page.goto(origin);await page.locator('#testimonials-root .testimonial-card').first().waitFor();
    assert.equal(await page.locator('.testimonials-track').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.locator('#menu-toggle').click();await page.locator('#mobile-menu a[href="#depoimentos"]').click();
    assert.equal(await page.locator('#mobile-menu').isVisible(),false);assert.equal(new URL(page.url()).hash,'#depoimentos');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const reduced=await browser.newContext({reducedMotion:'reduce'}),reducedPage=await reduced.newPage();
    await reducedPage.goto(origin);await reducedPage.locator('#testimonials-root .testimonial-card').first().waitFor();
    assert.equal(await reducedPage.locator('.testimonials-track').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.deepEqual(errors,[]);
    database.exec(readFileSync('backend/seeds/testimonials-demo.sql','utf8'));
    await page.reload();await page.locator('#depoimentos').scrollIntoViewIfNeeded();
    await page.locator('.testimonial-avatar img').evaluateAll(images=>images.forEach(img=>img.loading='eager'));
    await page.waitForFunction(()=>[...document.querySelectorAll('.testimonial-avatar img')].some(img=>img.src.endsWith('avatar-ana.svg')&&img.naturalWidth>0));
    assert.match(await page.locator('#depoimentos').innerText(),/Depoimento fictício/);
    await page.locator('#depoimentos').screenshot({path:'test-results/testimonials-demo-mobile.png'});
  }finally{await browser.close();}
});
