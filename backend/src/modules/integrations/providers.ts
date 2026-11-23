import type { Env } from '../../env';
import { shippingToken } from './shipping-token.ts';
import { asaasCredentialsMatch, isProduction } from '../../commerce-environment';

export class IntegrationError extends Error {
  public status: 400 | 409 | 502 | 503;
  constructor(message: string, status: 400 | 409 | 502 | 503 = 502) { super(message); this.status = status; }
}

// Hosts are fixed per environment so credentials cannot be redirected by configuration.
export async function providerRequest<T>(env: Env, provider: 'asaas' | 'shipping', path: string, body: unknown, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const asaas = provider === 'asaas';
  let token: string | undefined;
  try { token = asaas ? env.ASAAS_API_KEY : await shippingToken(env); }
  catch { throw new IntegrationError('Autorizacao Melhor Envio precisa de revisao. Autorize novamente o aplicativo.',503); }
  if (!token || (asaas ? !asaasCredentialsMatch(env) : !env.MELHOR_ENVIO_USER_AGENT || isProduction(env))) {
    throw new IntegrationError('A integração não está configurada para este ambiente.', 503);
  }
  const host = asaas
    ? (isProduction(env) ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3')
    : 'https://sandbox.melhorenvio.com.br/api/v2';
  let response: Response;
  try {
    response = await fetch(host + path, {
      // Workers supports follow/manual only. Never follow redirects carrying tokens.
      method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        'User-Agent': asaas ? 'Mascavo Fitwear' : env.MELHOR_ENVIO_USER_AGENT!,
        ...(asaas ? { access_token: token } : { Authorization: `Bearer ${token}` }),
      }, body: method === 'GET' ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new IntegrationError(asaas
      ? 'O Asaas não respondeu. Confira o painel Asaas antes de tentar novamente.'
      : 'Não foi possível conectar ao Melhor Envio. Tente consultar o frete novamente.');
  }
  if (!response.ok) throw new IntegrationError(`O ${asaas ? 'Asaas' : 'Melhor Envio'} recusou a solicitação (HTTP ${response.status}). Confira os dados e as credenciais da integração.`);
  try { return await response.json() as T; }
  catch { throw new IntegrationError('Resposta inválida do provedor.'); }
}

export function shippingDimensions(env: Env) {
  const values = [env.SHIPPING_ITEM_WEIGHT_KG, env.SHIPPING_ITEM_WIDTH_CM, env.SHIPPING_ITEM_HEIGHT_CM, env.SHIPPING_ITEM_LENGTH_CM].map(Number);
  if (values.some(v => !Number.isFinite(v) || v <= 0) || !/^\d{8}$/.test(env.SHIPPING_ORIGIN_CEP || '')) {
    throw new IntegrationError('Configure o CEP de origem, peso e medidas de teste em .dev.vars.', 503);
  }
  return { weight: values[0], width: values[1], height: values[2], length: values[3] };
}
