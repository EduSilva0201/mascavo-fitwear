import profile, { phoneSchema, requiredCpfSchema } from './profile';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../../env';
import { isProduction, productionMailConfigured } from '../../commerce-environment';
import { digest, equal, hashPassword, randomToken, verifyPassword } from './crypto';
import {
  cookie,
  createSession,
  csrfCookie,
  currentSession,
  now,
  rotateCsrf,
  sessionCookie,
  type Ctx,
} from './session';

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((s) => s.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const generic = {
  message: 'Se os dados permitirem, as instruções serão enviadas ao e-mail informado.',
};
const auth = new Hono<{ Bindings: Env }>();

async function limited(c: Ctx, account: string) {
  const time = now();
  // Atomic counters, shared across requests; never trust client-forwarded IPs in local mode.
  const ip = c.env.APP_ENV === 'local' ? 'loopback' : c.req.header('CF-Connecting-IP') || 'unknown';
  const buckets = [
    [`ip:${ip}`, 60],
    [`account:${account}`, 10],
  ] as const;
  await c.env.DB.prepare('DELETE FROM auth_rate_limits WHERE expires_at<=?').bind(time).run();
  const counters = await c.env.DB.batch<{ attempts: number }>(
    buckets.map(([key]) =>
      c.env.DB.prepare(
        `
    INSERT INTO auth_rate_limits(bucket,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`,
      ).bind(key, time + 900),
    ),
  );
  return counters.some((result, index) => Number(result.results[0]?.attempts) > buckets[index][1]);
}

auth.use('*', async (c, next) => {
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    if (
      c.req.header('Origin') !== c.env.APP_ORIGIN ||
      c.req.header('Sec-Fetch-Site') === 'cross-site'
    ) {
      return c.json({ error: 'Origem não permitida.' }, 403);
    }
    const token = getCookie(c, csrfCookie(c)) || '';
    if (!/^[a-f0-9]{64}$/.test(token) || !equal(token, c.req.header('X-CSRF-Token') || '')) {
      return c.json({ error: 'Atualize a página e tente novamente.' }, 403);
    }
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: 'Envie JSON.' }, 415);
  }
  await next();
});

auth.route('/profile', profile);

auth.get('/csrf', (c) => c.json({ csrfToken: rotateCsrf(c) }));
auth.get('/session', async (c) =>
  c.json({ customer: (await currentSession(c))?.customer || null }),
);

auth.post('/register', async (c) => {
  const production = isProduction(c.env);
  if (production && !productionMailConfigured(c.env))
    return c.json({ error: 'O cadastro ainda não está disponível.' }, 503);
  const parsed = z
    .object({
      name: z.string().trim().min(3).max(100),
      email: emailSchema,
      password: passwordSchema,
      cpf: requiredCpfSchema,
      phone: phoneSchema,
    })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: 'Informe nome, e-mail válido, CPF válido, telefone com DDD e senha de 12 a 128 caracteres.' }, 400);
  const { name, email, password, cpf, phone } = parsed.data;
  if (await limited(c, await digest(email))) {
    c.header('Retry-After', '900');
    return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
  }
  const passwordHash = await hashPassword(password);
  const id = crypto.randomUUID(),
    token = randomToken(),
    time = now();
  const tokenHash = await digest(token);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO customers(id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, name, email, passwordHash, time, time),
    c.env.DB.prepare(
      'INSERT INTO customer_profiles(customer_id,cpf,phone,updated_at) SELECT id,?,?,? FROM customers WHERE id=?',
    ).bind(cpf, phone, time, id),
    c.env.DB.prepare(
      "INSERT INTO auth_tokens(token_hash,customer_id,purpose,expires_at) SELECT ?,id,'verify',? FROM customers WHERE id=?",
    ).bind(tokenHash, time + 86400, id),
    c.env.DB.prepare(
      "INSERT INTO dev_mail(id,recipient,purpose,token,created_at,auth_token_hash) SELECT ?,email,'verify',?,?,? FROM customers WHERE id=?",
    ).bind(crypto.randomUUID(), token, time, production ? tokenHash : null, id),
  ]);
  return c.json(generic, 202);
});

auth.post('/login', async (c) => {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1).max(128) })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'E-mail ou senha inválidos.' }, 400);
  const { email, password } = parsed.data;
  if (await limited(c, await digest(email))) {
    c.header('Retry-After', '900');
    return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
  }
  const customer = await c.env.DB.prepare(
    'SELECT id,password_hash,status FROM customers WHERE email=?',
  )
    .bind(email)
    .first<{ id: string; password_hash: string; status: string }>();
  if (
    !(await verifyPassword(password, customer?.password_hash || null)) ||
    customer?.status !== 'active'
  ) {
    return c.json({ error: 'E-mail ou senha inválidos.' }, 401);
  }
  const csrfToken = await createSession(c, customer.id);
  return c.json({
    customer: await c.env.DB.prepare(
      'SELECT id,name,email,email_verified_at FROM customers WHERE id=?',
    )
      .bind(customer.id)
      .first(),
    csrfToken,
  });
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, sessionCookie(c));
  if (token)
    await c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?')
      .bind(now(), await digest(token))
      .run();
  cookie(c, sessionCookie(c), '', 0);
  return c.json({ csrfToken: rotateCsrf(c) });
});

auth.post('/forgot-password', async (c) => {
  const production = isProduction(c.env);
  if (production && !productionMailConfigured(c.env))
    return c.json({ error: 'A recuperação de senha ainda não está disponível.' }, 503);
  const parsed = z
    .object({ email: emailSchema })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Informe um e-mail válido.' }, 400);
  if (await limited(c, await digest(parsed.data.email))) {
    c.header('Retry-After', '900');
    return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
  }
  const customer = await c.env.DB.prepare(
    "SELECT id FROM customers WHERE email=? AND status='active'",
  )
    .bind(parsed.data.email)
    .first<{ id: string }>();
  if (customer) {
    const token = randomToken(),
      time = now();
    const tokenHash = await digest(token);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE auth_tokens SET used_at=? WHERE customer_id=? AND purpose='reset' AND used_at IS NULL",
      ).bind(time, customer.id),
      c.env.DB.prepare(
        "INSERT INTO auth_tokens(token_hash,customer_id,purpose,expires_at) VALUES (?,?,'reset',?)",
      ).bind(tokenHash, customer.id, time + 1800),
      c.env.DB.prepare(
        "INSERT INTO dev_mail(id,recipient,purpose,token,created_at,auth_token_hash) VALUES (?,?,'reset',?,?,?)",
      ).bind(crypto.randomUUID(), parsed.data.email, token, time, production ? tokenHash : null),
    ]);
  }
  return c.json(generic, 202);
});

auth.post('/verify-email', async (c) => {
  const parsed = z
    .object({ token: tokenSchema })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Token inválido ou expirado.' }, 400);
  if (await limited(c, 'verify-token')) return c.json({ error: 'Muitas tentativas.' }, 429);
  const hash = await digest(parsed.data.token),
    time = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE customers SET email_verified_at=?,updated_at=? WHERE id IN
      (SELECT customer_id FROM auth_tokens WHERE token_hash=? AND purpose='verify' AND used_at IS NULL AND expires_at>?)`,
    ).bind(time, time, hash, time),
    c.env.DB.prepare(
      "UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND purpose='verify' AND used_at IS NULL AND expires_at>?",
    ).bind(time, hash, time),
  ]);
  return results[0].meta.changes
    ? c.json({ message: 'E-mail confirmado. Você já pode entrar.' })
    : c.json({ error: 'Token inválido ou expirado.' }, 400);
});

auth.post('/reset-password', async (c) => {
  const parsed = z
    .object({ token: tokenSchema, password: passwordSchema })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: 'Informe um token válido e senha de 12 a 128 caracteres.' }, 400);
  if (await limited(c, 'reset-token')) return c.json({ error: 'Muitas tentativas.' }, 429);
  const hash = await digest(parsed.data.token),
    time = now();
  const token = await c.env.DB.prepare(
    "SELECT customer_id FROM auth_tokens WHERE token_hash=? AND purpose='reset' AND used_at IS NULL AND expires_at>?",
  )
    .bind(hash, time)
    .first<{ customer_id: string }>();
  if (!token) return c.json({ error: 'Token inválido ou expirado.' }, 400);
  const passwordHash = await hashPassword(parsed.data.password);
  // All three statements commit together. A competing/replayed reset cannot change the password.
  const condition =
    "SELECT customer_id FROM auth_tokens WHERE token_hash=? AND purpose='reset' AND used_at IS NULL AND expires_at>?";
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE customers SET password_hash=?,updated_at=?,email_verified_at=COALESCE(email_verified_at,?)
      WHERE status='active' AND id IN (${condition})`,
    ).bind(passwordHash, time, time, hash, time),
    c.env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE customer_id IN (${condition})`).bind(
      time,
      hash,
      time,
    ),
    c.env.DB.prepare(
      `UPDATE auth_tokens SET used_at=? WHERE used_at IS NULL AND customer_id IN (${condition})`,
    ).bind(time, hash, time),
  ]);
  if (!results[0].meta.changes) return c.json({ error: 'Token inválido ou expirado.' }, 400);
  cookie(c, sessionCookie(c), '', 0);
  return c.json({ message: 'Senha atualizada e e-mail confirmado. Entre com sua nova senha.', csrfToken: rotateCsrf(c) });
});

export default auth;
