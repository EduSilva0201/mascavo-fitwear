import type { Env } from '../../env';
import { now } from '../auth/session';
import { isProduction, productionMailConfigured } from '../../commerce-environment';
import { permanentEmailFailure, sendResend } from '../../resend';
import { emailLayout } from '../../email-layout';

const subjects: Record<string, string> = {
  order_created: 'Recebemos seu pedido',
  staff_order_created: 'Novo pedido na loja',
  payment_confirmed: 'Pagamento confirmado',
};

export function orderMailEnabled(env: Env) {
  if (isProduction(env)) return productionMailConfigured(env);
  return env.APP_ENV === 'staging' && Boolean(
    env.RESEND_API_KEY && env.ORDER_EMAIL_FROM && env.ORDER_EMAIL_TEST_TO,
  );
}

export function orderMailState(env: Env, kind: string) {
  return Object.hasOwn(subjects, kind) && orderMailEnabled(env) ? 'queued_email' : 'pending';
}

type Notification = {
  id: string;
  order_id: string;
  kind: string;
  recipient: string;
  payload_json: string;
  email_request_json: string | null;
  email_next_attempt_at: number;
};

function emailRequest(env: Env, row: Notification) {
  const { amountCents } = JSON.parse(row.payload_json) as { amountCents: number };
  const production = isProduction(env);
  const context = production ? '' : ' de teste';
  const total = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amountCents / 100);
  const staff = row.kind === 'staff_order_created';
  const message = staff
    ? 'Um novo pedido foi registrado. Consulte o painel para acompanhar o pagamento e combinar a entrega com o cliente.'
    : row.kind === 'payment_confirmed'
    ? 'O pagamento' + context + ' foi confirmado. Em até 24 horas após a confirmação, você receberá as informações de entrega pelo WhatsApp ou por e-mail.'
    : 'Seu pedido' + context + ' foi registrado. Consulte Minha conta para abrir a cobrança e acompanhar o pagamento.';
  const title = subjects[row.kind];
  const action = staff
    ? { url: env.APP_ORIGIN + '/admin', label: 'Abrir painel' }
    : { url: env.APP_ORIGIN + '/', label: 'Abrir Minha conta' };
  const summary = 'Pedido: ' + row.order_id + '\nTotal: ' + total;
  return JSON.stringify({
    from: env.ORDER_EMAIL_FROM,
    to: [production ? row.recipient : env.ORDER_EMAIL_TEST_TO],
    subject: (production ? '' : '[Teste] ') + title + ' | Mascavo Fitwear',
    text: message + '\n\n' + summary + '\n\n' + action.label + ': ' + action.url,
    html: emailLayout({ title, paragraphs: [message, summary], action }),
  });
}

export async function sendOrderMail(env: Env) {
  if (!orderMailEnabled(env)) return;
  const time = now();
  // Resend holds idempotency keys for 24 hours. Stop automatic retries before that window ends.
  const cutoff = time - 23 * 3600;
  await env.DB.prepare(
    "UPDATE order_notifications SET state='email_review' WHERE state='queued_email' AND email_started_at<=?",
  ).bind(cutoff).run();
  const pending = await env.DB.prepare(
    `SELECT id,order_id,kind,recipient,payload_json,email_request_json,email_next_attempt_at
      FROM order_notifications WHERE state='queued_email' AND email_next_attempt_at<=?
      ORDER BY created_at, CASE kind WHEN 'order_created' THEN 0 ELSE 1 END, id LIMIT 5`,
  ).bind(time).all<Notification>();
  for (const row of pending.results) {
    const body = row.email_request_json ?? emailRequest(env, row);
    const claim = await env.DB.prepare(
      `UPDATE order_notifications SET email_request_json=?, email_started_at=COALESCE(email_started_at,?),
        email_next_attempt_at=?, attempts=attempts+1
        WHERE id=? AND state='queued_email' AND email_next_attempt_at=?`,
    ).bind(body, time, time + 300, row.id, row.email_next_attempt_at).run();
    if (!claim.meta.changes) continue;
    try {
      const response = await sendResend(env, 'mascavo-order/' + row.id, body);
      if (response.ok) {
        const { id } = await response.json<{ id?: string }>();
        if (typeof id === 'string' && id) {
          await env.DB.prepare("UPDATE order_notifications SET state='email_accepted', email_provider_id=? WHERE id=?")
            .bind(id, row.id).run();
        }
      } else if (permanentEmailFailure(response.status)) {
        await env.DB.prepare("UPDATE order_notifications SET state='email_review' WHERE id=?")
          .bind(row.id).run();
      }
    } catch (error) {
      console.error('order_email_attempt_failed', { name: error instanceof Error ? error.name : 'Error' });
      // Outcomes after network failures are ambiguous. The queued retry reuses the same request and key.
    }
  }
}
