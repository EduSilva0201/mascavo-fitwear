import type { Env } from './env';

export function isProduction(env: Env) {
  return env.APP_ENV === 'production';
}

export function integratedShippingEnabled(env: Env) {
  return !isProduction(env) && env.MELHOR_ENVIO_ENABLED === 'true';
}

export function asaasCredentialsMatch(env: Env) {
  const key = env.ASAAS_API_KEY;
  return Boolean(key && (isProduction(env) ? key.startsWith('$aact_prod_') : !key.startsWith('$aact_prod_')));
}

export const PILOT_PRODUCT_ID = 999999991;
export const pilotDelivery = { feeCents: 0, cepPrefixes: [], estimate: 'Sem envio de produto' };

export function pilotAmount(env: Env) {
  const raw = env.CHECKOUT_PILOT_AMOUNT_CENTS ?? '';
  const amount = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function pilotConfigured(env: Env) {
  return isProduction(env) && env.CHECKOUT_ENABLED !== 'true' && Boolean(
    env.CHECKOUT_PILOT_EMAIL && pilotAmount(env) && asaasCredentialsMatch(env) &&
    (env.ASAAS_WEBHOOK_TOKEN?.length ?? 0) >= 32 && productionMailConfigured(env),
  );
}

export function checkoutEnabled(env: Env) {
  return !isProduction(env) || (
    env.CHECKOUT_ENABLED === 'true' && asaasCredentialsMatch(env) &&
    (env.ASAAS_WEBHOOK_TOKEN?.length ?? 0) >= 32 &&
    Boolean(productionMailConfigured(env) && deliveryTerms(env) && paymentMethods(env).length)
  );
}

export function productionMailConfigured(env: Env) {
  const address = env.ORDER_EMAIL_FROM?.trim().match(/([\w.+-]+@([\w.-]+))>?$/);
  return Boolean(env.RESEND_API_KEY?.startsWith('re_') && address && address[2].toLowerCase() !== 'resend.dev');
}

export function deliveryTerms(env: Env) {
  const rawFee = env.DELIVERY_FEE_CENTS ?? '';
  const cepPrefixes = (env.DELIVERY_CEP_PREFIXES ?? '').split(',').map(prefix => prefix.trim());
  const feeCents = Number(rawFee);
  const estimate = env.DELIVERY_ESTIMATE?.trim();
  if (!/^\d+$/.test(rawFee) || !Number.isSafeInteger(feeCents) || !cepPrefixes.every(prefix => /^\d{2,8}$/.test(prefix)) ||
    !estimate || estimate.length > 120)
    return null;
  return { feeCents, cepPrefixes, estimate };
}

export function paymentMethods(env: Env) {
  if (!isProduction(env)) return ['PIX', 'BOLETO', 'CREDIT_CARD'];
  const methods = [...new Set((env.ASAAS_PAYMENT_METHODS ?? 'PIX').split(',').map(method => method.trim()))];
  return methods.every(method => ['PIX', 'BOLETO', 'CREDIT_CARD'].includes(method)) ? methods : [];
}

export function asaasInvoiceUrl(value: string, env: Env) {
  const url = new URL(value);
  const origins = isProduction(env)
    ? ['https://www.asaas.com', 'https://asaas.com']
    : ['https://sandbox.asaas.com'];
  if (!origins.includes(url.origin) || url.username || url.password) throw new Error('Invalid Asaas invoice URL');
  return url.href;
}
