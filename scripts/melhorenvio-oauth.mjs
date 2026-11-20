import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const callbackPath = '/integracoes/melhorenvio/callback';
export const testPath = '/integracoes/melhorenvio';
const statePath = '.wrangler/melhorenvio-oauth-state.json';
const hash = value => createHash('sha256').update(value).digest();

export function page(title, message) {
  // Callers provide static text only; never render OAuth query parameters or credentials.
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Mascavo Fitwear</title><style>body{margin:0;background:#f7f4ee;color:#392c25;font:17px/1.65 system-ui}main{max-width:680px;margin:10vh auto;padding:36px}small{letter-spacing:.16em}h1{font-size:36px;line-height:1.2}p{max-width:58ch}a{color:inherit}</style><main><small>MASCAVO FITWEAR · SANDBOX</small><h1>${title}</h1><p>${message}</p><p><a href="${testPath}">Ambiente de testes da integração</a></p></main></html>`;
}

export async function config(envPath = '.dev.vars') {
  return parseEnv(await readFile(envPath, 'utf8'));
}

function credentials(env) {
  if (!env.MELHOR_ENVIO_CLIENT_ID || !env.MELHOR_ENVIO_CLIENT_SECRET || !env.MELHOR_ENVIO_USER_AGENT)
    throw new Error('Preencha MELHOR_ENVIO_CLIENT_ID, MELHOR_ENVIO_CLIENT_SECRET e MELHOR_ENVIO_USER_AGENT em .dev.vars.');
  const url = new URL(env.MELHOR_ENVIO_REDIRECT_URI);
  if (url.protocol !== 'https:' || url.pathname !== callbackPath || url.search || url.hash || url.username || url.password)
    throw new Error('MELHOR_ENVIO_REDIRECT_URI deve ser a URL HTTPS exata do callback.');
  return url.href;
}

export async function authorize({ envPath = '.dev.vars', pendingPath = statePath } = {}) {
  const env = await config(envPath);
  const redirect = credentials(env);
  const state = randomBytes(32).toString('hex');
  await mkdir(resolve(pendingPath, '..'), { recursive: true });
  await writeFile(pendingPath, JSON.stringify({ stateHash: hash(state).toString('hex'), expiresAt: Date.now() + 600000, redirect }), { mode: 0o600 });
  const url = new URL('https://sandbox.melhorenvio.com.br/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.MELHOR_ENVIO_CLIENT_ID, redirect_uri: redirect,
    response_type: 'code', state, scope: 'shipping-calculate cart-read cart-write orders-read shipping-checkout shipping-generate shipping-print shipping-cancel shipping-tracking' }).toString();
  return url.href;
}

export async function callback(url, { envPath = '.dev.vars', pendingPath = statePath, request = fetch } = {}) {
  if (!url.search) return [200, page('Retorno de autorização', 'Esta é a URL de retorno do aplicativo Melhor Envio Sandbox. Após cadastrar o aplicativo, configure suas credenciais e inicie a autorização pelo computador responsável pela integração.')];
  const state = url.searchParams.get('state') || '';
  if (!/^[a-f0-9]{64}$/.test(state) || url.searchParams.getAll('state').length !== 1)
    return [400, page('Autorização inválida', 'Inicie uma nova autorização pelo computador responsável pela integração.')];
  let pending;
  try { pending = JSON.parse(await readFile(pendingPath, 'utf8')); }
  catch { return [400, page('Autorização expirada', 'Não há uma autorização pendente. Inicie uma nova autorização localmente.')]; }
  if (pending.expiresAt < Date.now() || !/^[a-f0-9]{64}$/.test(pending.stateHash) ||
      !timingSafeEqual(hash(state), Buffer.from(pending.stateHash, 'hex')))
    return [400, page('Autorização inválida', 'A autorização expirou ou não corresponde à solicitação iniciada localmente.')];
  const env = await config(envPath);
  const redirect = credentials(env);
  if (pending.redirect !== redirect) return [400, page('Endereço alterado', 'Inicie uma nova autorização com o endereço cadastrado no aplicativo.')];
  // Atomic claim prevents concurrent callbacks from using the same authorization twice.
  const claimed = pendingPath + '.claimed';
  try { await rename(pendingPath, claimed); }
  catch { return [400, page('Autorização já utilizada', 'Inicie uma nova autorização localmente.')]; }
  try {
    if (url.searchParams.has('error')) return [400, page('Autorização cancelada', 'O Melhor Envio não concedeu a autorização. Você pode iniciar uma nova tentativa localmente.')];
    const code = url.searchParams.get('code');
    if (!code || code.length > 8192 || url.searchParams.getAll('code').length !== 1)
      return [400, page('Código ausente', 'O Melhor Envio não enviou um código de autorização válido.')];
    const response = await request('https://sandbox.melhorenvio.com.br/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': env.MELHOR_ENVIO_USER_AGENT },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: env.MELHOR_ENVIO_CLIENT_ID,
        client_secret: env.MELHOR_ENVIO_CLIENT_SECRET, redirect_uri: redirect, code }),
    });
    if (!response.ok) throw new Error('Token exchange failed');
    const tokens = await response.json();
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)
      throw new Error('Invalid token response');
    let source = await readFile(envPath, 'utf8');
    for (const [key, value] of Object.entries({ MELHOR_ENVIO_TOKEN: tokens.access_token,
      MELHOR_ENVIO_REFRESH_TOKEN: tokens.refresh_token,
      MELHOR_ENVIO_TOKEN_EXPIRES_AT: String(Date.now() + tokens.expires_in * 1000) })) {
      if (!/^[\x21-\x7e]+$/.test(value) || /["'\\#]/.test(value)) throw new Error('Invalid token format');
      const line = `${key}="${value}"`;
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      source = pattern.test(source) ? source.replace(pattern, () => line) : source + '\n' + line + '\n';
    }
    await writeFile(envPath + '.oauth-tmp', source, { mode: 0o600 });
    await rename(envPath + '.oauth-tmp', envPath);
    return [200, page('Melhor Envio autorizado', 'A autorização Sandbox foi salva com segurança. Reinicie o backend local para utilizar o token nas cotações de frete. Nenhuma etiqueta foi comprada ou emitida.')];
  } catch {
    return [502, page('Não foi possível concluir', 'A troca do código ou o armazenamento da autorização falhou. Inicie uma nova autorização localmente; o código não será reenviado automaticamente.')];
  } finally { await unlink(claimed).catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log('Abra este link em até 10 minutos:\n' + await authorize()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
