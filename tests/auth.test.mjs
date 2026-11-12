import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:8791';
const state = resolve('.wrangler', 'tests', crypto.randomUUID());
const env = {
  ...process.env,
  WRANGLER_LOG_PATH: resolve('.wrangler/test-logs'),
  WRANGLER_SEND_METRICS: 'false',
  CI: 'true',
};
const cli = ['node_modules/wrangler/bin/wrangler.js'];
let server,
  database,
  output = '';
const password = 'Ficticia!Mascavo-2026';
const newPassword = 'Outra!Ficticia-2026';
const email = 'cliente@example.test';

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
    [...cli, 'd1', 'migrations', 'apply', 'mascavo-local', '--local', '--persist-to', state],
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
  const r = await client.auth('register', {
    name: 'Cliente Fictício',
    email: 'Cliente@Example.Test',
    password,
  });
  t.diagnostic(
    `Cadastro com Argon2id no workerd local: ${Math.round(performance.now() - start)} ms (tempo total HTTP).`,
  );
  assert.equal(r.status, 202);
  const duplicate = await client.auth('register', { name: 'Outro Nome', email, password });
  assert.deepEqual(duplicate.body, r.body);
  assert.equal(duplicate.status, 202);
  const row = database.prepare('SELECT * FROM customers WHERE email=?').get(email);
  assert.equal(row.role, 'customer');
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
  const stolen = new Client();
  stolen.cookies = new Map(client.cookies);
  assert.equal((await client.auth('logout', {})).status, 200);
  assert.equal((await stolen.auth('session')).body.customer, null);
});
test('expiração de sessão e checkout sempre fechado', async () => {
  assert.equal((await client.call('/api/v1/orders', {})).status, 401);
  assert.equal((await client.auth('login', { email, password })).status, 200);
  assert.equal((await client.call('/api/v1/orders', {})).status, 503);
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
    assert.equal(await page.locator('.product').count(), 8);
    await page.locator('[data-card-color="1"][data-color="Cacau"]').click();
    await page.locator('[data-card-size="1"][data-value="M"]').click();
    await page.locator('[data-quick="1"]').click();
    await page.locator('#cart-toggle').click();
    assert.match(await page.locator('#cart-items').innerText(), /Cacau.*M/);
    assert.equal(await page.locator('#cart-summary .primary').isDisabled(), true);
    await page.locator('[data-qty="0"][data-delta="1"]').click();
    assert.equal(await page.locator('#count').innerText(), '2');
    await page.locator('#cart-dialog [data-close]').click();
    await page.locator('#account-toggle').click();
    await page.locator('[data-account-tab="register"]').click();
    await page.locator('[name="name"]').fill('Cliente Visual Fictício');
    await page.locator('[name="email"]').fill('visual@example.test');
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
    assert.equal(await page.locator('.product').count(), 2);
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
  assert.equal((await person.auth('register',{name:'Cliente Teste',email,password})).status,202);
  assert.equal((await person.auth('login',{email,password})).status,200);
 }
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',cpf:'11111111111',phone:''})).status,400);
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',cpf:'',phone:'11999990000'},{'X-CSRF-Token':'bad'})).status,403);
 await owner.init();
 assert.equal((await owner.auth('profile',{name:'Cliente Atualizado',cpf:'',phone:'11999990000'})).status,200);
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
  assert.equal(await page.locator('header.navbar').evaluate(el=>el.inert),true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rail-dialog',{state:'detached'});
  assert.equal(await page.locator('header.navbar').evaluate(el=>el.inert),false);
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
