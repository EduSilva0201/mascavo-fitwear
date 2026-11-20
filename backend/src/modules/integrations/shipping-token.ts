import type { Env } from '../../env';

// This helper never exports credentials through routes, diagnostics or logs.
export async function shippingToken(env: Env): Promise<string | undefined> {
  if (!env.MELHOR_ENVIO_REFRESH_TOKEN || !env.MELHOR_ENVIO_TOKEN_EXPIRES_AT)
    return env.MELHOR_ENVIO_TOKEN;
  const expiry = Number(env.MELHOR_ENVIO_TOKEN_EXPIRES_AT);
  if (!Number.isFinite(expiry) || !env.MELHOR_ENVIO_TOKEN)
    throw new Error('Invalid OAuth configuration');
  await env.DB.prepare(
    `INSERT INTO integration_tokens(provider,access_token,refresh_token,expires_at)
 VALUES ('shipping',?,?,?) ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,
 refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,refresh_state='idle'
 WHERE integration_tokens.expires_at<excluded.expires_at`,
  )
    .bind(env.MELHOR_ENVIO_TOKEN, env.MELHOR_ENVIO_REFRESH_TOKEN, expiry)
    .run();
  const row = await env.DB.prepare(
    "SELECT * FROM integration_tokens WHERE provider='shipping'",
  ).first<{
    access_token: string;
    refresh_token: string;
    expires_at: number;
    refresh_state: string;
  }>();
  if (!row) throw new Error('Missing OAuth token');
  if (row.expires_at > Date.now() + 300000) return row.access_token;
  if (
    !env.MELHOR_ENVIO_CLIENT_ID ||
    !env.MELHOR_ENVIO_CLIENT_SECRET ||
    !env.MELHOR_ENVIO_USER_AGENT
  )
    throw new Error('Missing OAuth credentials');
  const lock = await env.DB.prepare(
    "UPDATE integration_tokens SET refresh_state='processing' WHERE provider='shipping' AND refresh_state='idle' AND expires_at=?",
  )
    .bind(row.expires_at)
    .run();
  if (!lock.meta.changes) throw new Error('OAuth refresh already running or requires review');
  try {
    const response = await fetch('https://sandbox.melhorenvio.com.br/oauth/token', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': env.MELHOR_ENVIO_USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.MELHOR_ENVIO_CLIENT_ID,
        client_secret: env.MELHOR_ENVIO_CLIENT_SECRET,
        refresh_token: row.refresh_token,
      }),
    });
    if (!response.ok) throw new Error('Refresh rejected');
    const token = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    if (
      !token.access_token ||
      !token.refresh_token ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    )
      throw new Error('Invalid refresh response');
    await env.DB.prepare(
      "UPDATE integration_tokens SET access_token=?,refresh_token=?,expires_at=?,refresh_state='idle' WHERE provider='shipping'",
    )
      .bind(token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000)
      .run();
    return token.access_token;
  } catch {
    await env.DB.prepare(
      "UPDATE integration_tokens SET refresh_state='review' WHERE provider='shipping'",
    ).run();
    throw new Error('OAuth refresh requires new authorization');
  }
}
