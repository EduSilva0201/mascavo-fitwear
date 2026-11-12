import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../../env';
import { digest, randomToken } from './crypto';

export type Ctx = Context<{ Bindings: Env }>;
const DAY = 86400;
export const now = () => Math.floor(Date.now() / 1000);
export const secure = (c: Ctx) => new URL(c.req.url).protocol === 'https:';
export const sessionCookie = (c: Ctx) =>
  secure(c) ? '__Host-mascavo-session' : 'mascavo-session-local';
export const csrfCookie = (c: Ctx) => (secure(c) ? '__Host-mascavo-csrf' : 'mascavo-csrf-local');
export function cookie(c: Ctx, name: string, value: string, maxAge: number) {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: secure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });
}
export function rotateCsrf(c: Ctx) {
  const token = randomToken();
  cookie(c, csrfCookie(c), token, 7 * DAY);
  return token;
}
export async function createSession(c: Ctx, customerId: string) {
  const token = randomToken();
  const time = now();
  const old = getCookie(c, sessionCookie(c));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(
      time,
      old ? await digest(old) : '',
    ),
    c.env.DB.prepare(
      'INSERT INTO sessions (token_hash,customer_id,created_at,last_seen_at,expires_at,idle_expires_at) VALUES (?,?,?,?,?,?)',
    ).bind(await digest(token), customerId, time, time, time + 7 * DAY, time + DAY),
  ]);
  cookie(c, sessionCookie(c), token, 7 * DAY);
  return rotateCsrf(c);
}
export async function currentSession(c: Ctx) {
  const token = getCookie(c, sessionCookie(c));
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await digest(token);
  const time = now();
  const row = await c.env.DB.prepare(
    `SELECT c.id,c.name,c.email,c.email_verified_at,s.expires_at
    FROM sessions s JOIN customers c ON c.id=s.customer_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.idle_expires_at>? AND c.status='active'`,
  )
    .bind(tokenHash, time, time)
    .first<{
      id: string;
      name: string;
      email: string;
      email_verified_at: number | null;
      expires_at: number;
    }>();
  if (!row) return null;
  await c.env.DB.prepare(
    'UPDATE sessions SET last_seen_at=?,idle_expires_at=MIN(expires_at,?) WHERE token_hash=? AND revoked_at IS NULL',
  )
    .bind(time, time + DAY, tokenHash)
    .run();
  return {
    tokenHash,
    customer: {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: !!row.email_verified_at,
    },
  };
}
