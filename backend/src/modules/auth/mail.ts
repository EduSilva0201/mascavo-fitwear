import type { Env } from '../../env';
import { isProduction, productionMailConfigured } from '../../commerce-environment';
import { permanentEmailFailure, sendResend } from '../../resend';
import { now } from './session';
import { emailLayout } from '../../email-layout';

export async function sendAccountMail(env: Env) {
  if (!isProduction(env) || !productionMailConfigured(env)) return;
  const time = now();
  await env.DB.prepare(
    `DELETE FROM dev_mail WHERE auth_token_hash IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM auth_tokens WHERE token_hash=dev_mail.auth_token_hash AND used_at IS NULL AND expires_at>?)`,
  ).bind(time).run();
  const rows = await env.DB.prepare(
    `SELECT id,recipient,purpose,token,next_attempt_at,email_request_json FROM dev_mail
      WHERE auth_token_hash IS NOT NULL AND next_attempt_at<=? ORDER BY created_at LIMIT 5`,
  ).bind(time).all<{ id: string; recipient: string; purpose: string; token: string; next_attempt_at: number; email_request_json: string | null }>();
  for (const row of rows.results) {
    const reset = row.purpose === 'reset';
    const actionUrl = env.APP_ORIGIN + '/#' + (reset ? 'mascavo-redefinir=' : 'mascavo-confirmar=') + row.token;
    const title = reset ? 'Recupere sua senha' : 'Confirme seu e-mail';
    const message = reset ? 'Abra o link abaixo para definir sua senha e confirmar seu e-mail em uma etapa. Ele vale por 30 minutos.'
      : 'Abra o link abaixo para confirmar seu e-mail. Ele vale por 24 horas.';
    const code = 'Se preferir, use este código em Minha conta:\n' + row.token;
    const disclaimer = 'Se você não fez essa solicitação, ignore esta mensagem.';
    const body = row.email_request_json ?? JSON.stringify({
      from: env.ORDER_EMAIL_FROM,
      to: [row.recipient],
      subject: title + ' | Mascavo Fitwear',
      text: [message, actionUrl, code, disclaimer].join('\n\n'),
      // A pending request attempted before this migration must keep its original payload.
      ...(row.next_attempt_at === 0 ? { html: emailLayout({
        title, paragraphs: [message], action: { url: actionUrl, label: reset ? 'Definir senha' : 'Confirmar e-mail' },
        footer: [code, disclaimer],
      }) } : {}),
    });
    const claim = await env.DB.prepare(
      'UPDATE dev_mail SET next_attempt_at=?,email_request_json=? WHERE id=? AND next_attempt_at=?',
    ).bind(time + 120, body, row.id, row.next_attempt_at).run();
    if (!claim.meta.changes) continue;
    try {
      const response = await sendResend(env, 'mascavo-account/' + row.id, body);
      if (response.ok) {
        await env.DB.prepare('DELETE FROM dev_mail WHERE id=?').bind(row.id).run();
      } else if (permanentEmailFailure(response.status)) {
        console.error('account_email_rejected', { status: response.status });
        // Stop retrying this request. Keep it subject to the usual token expiry cleanup.
        await env.DB.prepare('UPDATE dev_mail SET next_attempt_at=? WHERE id=?')
          .bind(time + 86400, row.id).run();
      }
    } catch {
      console.error('account_email_attempt_failed');
    }
  }
}
