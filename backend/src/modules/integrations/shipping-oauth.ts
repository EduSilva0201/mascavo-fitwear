import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../../env';
import { digest, equal, randomToken } from '../auth/crypto';
import { currentSession } from '../auth/session';

const path = '/integracoes/melhorenvio';
const callbackPath = path + '/callback';
const cookieName = '__Host-mascavo-shipping-oauth';
const lifetime = 600;
const sandbox = 'https://sandbox.melhorenvio.com.br';
const scope = 'shipping-calculate cart-read cart-write orders-read shipping-checkout shipping-generate shipping-print shipping-cancel shipping-tracking';
const cookieOptions = { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } as const;
const oauth = new Hono<{ Bindings: Env }>();

oauth.use('*', async (c, next) => {
  if (c.env.APP_ENV !== 'staging') return c.notFound();
  await next();
});

oauth.get('/', (c) => {
  c.header('Referrer-Policy', 'same-origin');
  c.header('Content-Security-Policy', "default-src 'none'; form-action 'self' https://sandbox.melhorenvio.com.br; frame-ancestors 'none'; base-uri 'none'");
  return c.html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
    <title>Melhor Envio Sandbox | Mascavo Fitwear</title>
    <h1>Melhor Envio Sandbox</h1>
    <p>Entre na loja com uma conta de administrador para conectar o aplicativo.</p>
    <form method="post" action="${path}"><button>Autorizar no Melhor Envio</button></form>`);
});

oauth.post('/', async (c) => {
  const env = c.env;
  if (c.req.header('Origin') !== env.APP_ORIGIN) return c.text('Origem inválida.', 403);
  const session = await currentSession(c);
  if (!session) return c.text('Entre na loja com uma conta de administrador.', 401);
  const customer = await env.DB.prepare("SELECT role FROM customers WHERE id=? AND status='active' AND email_verified_at IS NOT NULL")
    .bind(session.customer.id).first<{ role: string }>();
  if (customer?.role !== 'admin') return c.text('Acesso administrativo necessário.', 403);
  if (!env.MELHOR_ENVIO_CLIENT_ID || !env.MELHOR_ENVIO_CLIENT_SECRET || !env.MELHOR_ENVIO_USER_AGENT)
    return c.text('Configure as credenciais Sandbox no Worker.', 503);

  const state = randomToken();
  const now = Date.now();
  const attempt = await env.DB.prepare(
    `INSERT INTO shipping_oauth_attempt (id,state_hash,expires_at) VALUES (1,?,?)
     ON CONFLICT(id) DO UPDATE SET state_hash=excluded.state_hash,expires_at=excluded.expires_at,processing=0
     WHERE shipping_oauth_attempt.expires_at<=?`,
  ).bind(await digest(state), now + lifetime * 1000, now).run();
  if (!attempt.meta.changes) return c.text('Já há uma autorização em andamento. Aguarde até dez minutos para iniciar outra.', 409);

  setCookie(c, cookieName, state, { ...cookieOptions, maxAge: lifetime });
  const url = new URL('/oauth/authorize', sandbox);
  url.search = new URLSearchParams({
    client_id: env.MELHOR_ENVIO_CLIENT_ID, redirect_uri: env.APP_ORIGIN + callbackPath,
    response_type: 'code', state, scope,
  }).toString();
  return c.redirect(url.href, 303);
});

oauth.get('/callback', async (c) => {
  const env = c.env;
  const params = new URL(c.req.url).searchParams;
  if (!params.size) return c.text('Use /integracoes/melhorenvio para iniciar a autorização Sandbox.');
  const state = params.get('state') ?? '';
  if (params.getAll('state').length !== 1 || !/^[a-f0-9]{64}$/.test(state) ||
      !equal(state, getCookie(c, cookieName) ?? ''))
    return c.text('Autorização inválida ou expirada. Inicie novamente no mesmo navegador.', 400);
  if (!env.MELHOR_ENVIO_CLIENT_ID || !env.MELHOR_ENVIO_CLIENT_SECRET || !env.MELHOR_ENVIO_USER_AGENT)
    return c.text('Configure as credenciais Sandbox no Worker.', 503);

  const stateHash = await digest(state);
  const claimed = await env.DB.prepare(
    'UPDATE shipping_oauth_attempt SET processing=1,expires_at=? WHERE state_hash=? AND processing=0 AND expires_at>?',
  ).bind(Date.now() + 60000, stateHash, Date.now()).run();
  if (!claimed.meta.changes) return c.text('Autorização já utilizada ou expirada.', 400);
  deleteCookie(c, cookieName, cookieOptions);

  try {
    const code = params.get('code');
    if (params.has('error') || !code || code.length > 8192 || params.getAll('code').length !== 1)
      return c.text('O Melhor Envio não concedeu a autorização. Inicie uma nova tentativa.', 400);
    const response = await fetch(sandbox + '/oauth/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': env.MELHOR_ENVIO_USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: env.APP_ORIGIN + callbackPath,
        client_id: env.MELHOR_ENVIO_CLIENT_ID, client_secret: env.MELHOR_ENVIO_CLIENT_SECRET,
      }).toString(),
    });
    if (!response.ok) throw new Error('OAuth exchange rejected');
    const token = await response.json<{ access_token: string; refresh_token: string; expires_in: number }>();
    if (typeof token.access_token !== 'string' || !token.access_token ||
        typeof token.refresh_token !== 'string' || !token.refresh_token ||
        !Number.isFinite(token.expires_in) || token.expires_in <= 0)
      throw new Error('Invalid OAuth token response');
    const saved = await env.DB.prepare(
      `INSERT INTO integration_tokens(provider,access_token,refresh_token,expires_at)
       SELECT 'shipping',?,?,? WHERE EXISTS (SELECT 1 FROM shipping_oauth_attempt WHERE state_hash=?)
       ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,
       expires_at=excluded.expires_at,refresh_state='idle'`,
    ).bind(token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000, stateHash).run();
    if (!saved.meta.changes) throw new Error('OAuth attempt replaced');
    return c.text('Melhor Envio Sandbox autorizado. A loja já pode usar esta autorização para cotar frete.');
  } catch (error) {
    console.error('shipping_oauth_failed', { name: error instanceof Error ? error.name : 'unknown' });
    return c.text('Não foi possível concluir a autorização. Inicie uma nova tentativa.', 502);
  } finally {
    await env.DB.prepare('DELETE FROM shipping_oauth_attempt WHERE state_hash=?').bind(stateHash).run();
  }
});

export default oauth;
