import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import type { Env } from './env';
import auth from './modules/auth/routes';
import catalog from './modules/catalog/routes';
import integrations from './modules/integrations/routes';
import admin from './modules/admin/routes';
import { publicContent } from './modules/content/routes';
import { csrfCookie, currentSession } from './modules/auth/session';
import { equal } from './modules/auth/crypto';
import webhooks from './modules/webhooks/routes';
import orders from './modules/orders/routes';
import { maintenance } from './modules/orders/events';

const app = new Hono<{ Bindings: Env }>();
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const local = c.env.APP_ENV === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const staging = c.env.APP_ENV === 'staging' && url.protocol === 'https:';
  if ((!local && !staging) || url.origin !== c.env.APP_ORIGIN)
    return c.json({ error: 'Ambiente remoto ainda não habilitado.' }, 503);
  if (staging) {
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('Cache-Control', 'no-store');
    // Only these two POST endpoints bypass the gate; each authenticates its provider.
    const webhook = c.req.method === 'POST' && ['/api/v1/webhooks/asaas', '/api/v1/webhooks/melhorenvio'].includes(url.pathname);
    if (!webhook) {
      if (!c.env.STAGING_USERNAME || !c.env.STAGING_PASSWORD || c.env.STAGING_PASSWORD.length < 24)
        return c.json({ error: 'Configure o acesso restrito da homologacao.' }, 503);
      const expected = `Basic ${btoa(`${c.env.STAGING_USERNAME}:${c.env.STAGING_PASSWORD}`)}`;
      if (!equal(c.req.header('Authorization') || '', expected)) {
        c.header('WWW-Authenticate', 'Basic realm="Mascavo homologacao", charset="UTF-8"');
        return c.json({ error: 'Homologacao restrita.' }, 401);
      }
    }
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  if (staging) c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (staging || url.pathname.startsWith('/api/')) c.header('Cache-Control', 'no-store');
});
app.use(
  '/api/*',
  async (c,next) => bodyLimit({ maxSize: c.req.path === '/api/v1/admin/media' ? 5*1024*1024 : c.req.path.startsWith('/api/v1/admin/') ? 65536 : 8192, onError: (ctx) => ctx.json({ error: 'Requisição muito grande.' }, 413) })(c,next),
);
app.get('/api/v1/health', (c) => c.json({ status: 'ok', environment: c.env.APP_ENV, checkout: 'sandbox', production: false }));
app.route('/api/v1/auth', auth);
app.route('/api/v1/webhooks', webhooks);
app.route('/api/v1/orders', orders);
app.route('/api/v1/catalog', catalog);
app.route('/api/v1/integrations', integrations);
app.route('/api/v1/admin', admin);
app.route('/api/v1/content', publicContent);
app.get('/api/v1/store',async c=>{
  const row=await c.env.DB.prepare('SELECT data FROM store_settings WHERE id=1').first<{data:string}>();
  return c.json({settings:row?JSON.parse(row.data):{}});
});
app.get('/media/:key',async c=>{
  const key=c.req.param('key');
  if(!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(key))return c.notFound();
  const object=await c.env.IMAGES.get(key);
  if(!object)return c.notFound();
  c.header('Content-Type',object.httpMetadata?.contentType || 'application/octet-stream');
  c.header('Cache-Control','public,max-age=31536000,immutable');
  return c.body(object.body);
});
app.get('/api/v1/dev/mail', async (c) => {
  if (c.env.APP_ENV !== 'local') return c.notFound();
  const token = getCookie(c, csrfCookie(c)) || '';
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    !equal(token, c.req.header('X-CSRF-Token') || '') ||
    c.req.header('Origin') !== c.env.APP_ORIGIN
  )
    return c.json({ error: 'Acesso local protegido.' }, 403);
  const mail = await c.env.DB.prepare(
    'SELECT recipient,purpose,token,created_at FROM dev_mail WHERE created_at>? ORDER BY created_at DESC LIMIT 20',
  )
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .all();
  return c.json({ messages: mail.results });
});
app.all('/api/*', (c) => c.json({ error: 'Rota não encontrada.' }, 404));
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400);
  console.error('request_failed', { name: error.name });
  return c.json({ error: 'Não foi possível concluir a operação.' }, 500);
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.APP_ENV !== 'staging') return;
    ctx.waitUntil(maintenance(env));
  },
};
