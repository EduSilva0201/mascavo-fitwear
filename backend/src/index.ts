import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import type { Env } from './env';
import auth from './modules/auth/routes';
import catalog from './modules/catalog/routes';
import { csrfCookie, currentSession } from './modules/auth/session';
import { equal } from './modules/auth/crypto';

const app = new Hono<{ Bindings: Env }>();
app.use('*', async (c, next) => {
  // This first milestone is intentionally local-only, including the test mailbox.
  const url = new URL(c.req.url);
  if (
    c.env.APP_ENV !== 'local' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.origin !== c.env.APP_ORIGIN
  )
    return c.json({ error: 'Ambiente remoto ainda não habilitado.' }, 503);
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  if (url.pathname.startsWith('/api/')) c.header('Cache-Control', 'no-store');
});
app.use(
  '/api/*',
  bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: 'Requisição muito grande.' }, 413) }),
);
app.get('/api/v1/health', (c) => c.json({ status: 'ok', environment: 'local', checkout: false }));
app.route('/api/v1/auth', auth);
app.route('/api/v1/catalog', catalog);
app.get('/api/v1/dev/mail', async (c) => {
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
// Explicitly closed until authoritative catalog, stock and payment rules exist.
app.post('/api/v1/orders', async (c) => {
  if (!(await currentSession(c))) return c.json({ error: 'Entre para continuar.' }, 401);
  return c.json({ error: 'Checkout ainda não disponível.' }, 503);
});
app.all('/api/*', (c) => c.json({ error: 'Rota não encontrada.' }, 404));
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400);
  console.error('request_failed', { name: error.name });
  return c.json({ error: 'Não foi possível concluir a operação.' }, 500);
});
export default app;
