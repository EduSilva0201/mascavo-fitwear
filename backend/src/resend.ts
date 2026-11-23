import type { Env } from './env';

export function sendResend(env: Env, key: string, body: string) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body,
  });
}

export const permanentEmailFailure = (status: number) =>
  status >= 300 && status < 500 && ![408, 409, 429].includes(status);
