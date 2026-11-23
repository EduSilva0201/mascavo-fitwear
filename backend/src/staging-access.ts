import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Env } from './env';
import { equal } from './modules/auth/crypto';

const accessPath = '/acesso-homologacao';
const cookieName = '__Host-mascavo-staging';
const sessionSeconds = 12 * 60 * 60;
const limitForm = bodyLimit({ maxSize: 4096, onError: (c) => c.text('Formulário muito grande.', 413) });

function accessPage(c: Context<{ Bindings: Env }>, failed = false) {
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  return c.html(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acesso à homologação | Mascavo Fitwear</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;background:#261307;color:#342115;font:1rem/1.5 system-ui,sans-serif}
main{width:min(100%,26rem);padding:clamp(1.25rem,6vw,2rem);border-radius:1rem;background:#fff9f2}h1{font:1.85rem Georgia,serif;margin:.5rem 0}
label{display:block;margin:1rem 0}input,button{display:block;width:100%;font:inherit;padding:.7rem;border:1px solid #927660;border-radius:.5rem}button{background:#402718;color:#fff9f2;cursor:pointer}p[role=alert]{color:#9b231e}
</style></head><body><main><strong>Mascavo Fitwear</strong><h1>Acesso à homologação</h1>
<p>Use as credenciais de teste para abrir a loja.</p>
${failed ? '<p role="alert">Usuário ou senha incorretos. Tente novamente.</p>' : ''}
<form method="post" action="${accessPath}">
<label>Usuário<input name="username" autocomplete="username" autocapitalize="none" required maxlength="128"></label>
<label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
<button type="submit">Entrar na loja</button></form></main></body></html>`, 401);
}

export async function checkStagingAccess(c: Context<{ Bindings: Env }>, url: URL) {
  const method = c.req.method;
  if (method === 'POST' && ['/api/v1/webhooks/asaas', '/api/v1/webhooks/melhorenvio'].includes(url.pathname)) return;

  const { STAGING_USERNAME: username, STAGING_PASSWORD: password } = c.env;
  if (!username || !password || password.length < 24)
    return c.json({ error: 'Configure o acesso restrito da homologacao.' }, 503);

  if (method === 'POST' && url.pathname === accessPath) {
    if (c.req.header('Origin') !== url.origin) return c.text('Origem inválida.', 403);
    if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))
      return c.text('Formato de formulário inválido.', 415);
    const response = await limitForm(c, async () => {
      const form = new URLSearchParams(await c.req.text());
      const validUser = equal(form.get('username') ?? '', username);
      const validPassword = equal(form.get('password') ?? '', password);
      if (!validUser || !validPassword) {
        c.res = accessPage(c, true);
        return;
      }
      const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
      await setSignedCookie(c, cookieName, `${expires}:${username}`, password, {
        secure: true, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: sessionSeconds,
      });
      c.res = c.redirect('/', 303);
    });
    return response ?? c.res;
  }

  const expected = `Basic ${btoa(`${username}:${password}`)}`;
  if (equal(c.req.header('Authorization') ?? '', expected)) return;
  const session = await getSignedCookie(c, password, cookieName);
  if (session) {
    const separator = session.indexOf(':');
    const expires = Number(session.slice(0, separator));
    if (separator > 0 && expires > Math.floor(Date.now() / 1000) && session.slice(separator + 1) === username) return;
  }
  if (method === 'GET' && !url.pathname.startsWith('/api/') && c.req.header('Accept')?.includes('text/html'))
    return accessPage(c);
  c.header('WWW-Authenticate', 'Basic realm="Mascavo homologacao", charset="UTF-8"');
  return c.json({ error: 'Homologacao restrita.' }, 401);
}
