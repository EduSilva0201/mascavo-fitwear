import type { Env } from '../../env';
import { getOrder, expireReservations, reconcilePayment, deliverLocalMail } from './service';
import { applyShippingStatus, reconcileShipment, type Shipment } from './shipping';
import { now } from '../auth/session';

export async function processEvents(env: Env) {
  const deadline = Date.now() + 10000;
  await expireReservations(env);
  const events = await env.DB.prepare(
    "SELECT * FROM commerce_events WHERE state='pending' ORDER BY received_at LIMIT 25",
  ).all<{ provider: string; id: string; resource_id: string; payload_json: string }>();
  for (const event of events.results) {
    if (Date.now() > deadline) break;
    try {
      const payload = JSON.parse(event.payload_json);
      if (event.provider === 'asaas') {
        // Always query the provider: stale webhooks cannot roll back authoritative state.
        const row = await env.DB.prepare(
          'SELECT id FROM orders WHERE provider_id=? OR installment_id=?',
        )
          .bind(event.resource_id, payload.payment?.installment || '')
          .first<{ id: string }>();
        if (row) await reconcilePayment(env, (await getOrder(env, row.id))!);
        else {
          // Payment webhooks can arrive before the create-payment response was saved.
          const waiting = await env.DB.prepare(
            "SELECT id FROM orders WHERE id=? AND payment_state IN ('creating','review')",
          )
            .bind(payload.payment?.externalReference || '')
            .first();
          if (waiting) continue;
        }
      } else {
        const shipment = await env.DB.prepare('SELECT * FROM shipments WHERE provider_id=?')
          .bind(event.resource_id)
          .first<Shipment>();
        if (shipment) {
          const d = payload.data;
          const dates = [
            d.updated_at,
            d.delivered_at,
            d.posted_at,
            d.generated_at,
            d.paid_at,
            d.created_at,
          ]
            .filter(
              (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v as string)),
            )
            .sort((a: string, b: string) => Date.parse(b) - Date.parse(a));
          await applyShippingStatus(env, shipment, d, dates[0]);
        }
      }
      await env.DB.prepare("UPDATE commerce_events SET state='processed' WHERE provider=? AND id=?")
        .bind(event.provider, event.id)
        .run();
    } catch {
      // Remains durable and retryable. Never log payloads, CPF, tokens or provider bodies.
      console.error('commerce_event_pending', { provider: event.provider });
    }
  }
  await deliverLocalMail(env);
  return {
    pending: (await env.DB.prepare(
      "SELECT COUNT(*) n FROM commerce_events WHERE state='pending'",
    ).first<{ n: number }>())!.n,
  };
}
export async function maintenance(env: Env) {
  const result = await processEvents(env);
  const payments = await env.DB.prepare(
        "SELECT id FROM orders WHERE payment_state IN ('pending','creating','review','paid') AND checked_at<? ORDER BY checked_at LIMIT 1",
  )
    .bind(now() - 60)
    .all<{ id: string }>();
  for (const { id } of payments.results) {
    try {
      await reconcilePayment(env, (await getOrder(env, id))!);
    } catch {}
    await env.DB.prepare('UPDATE orders SET checked_at=? WHERE id=?').bind(now(), id).run();
  }
  const shipments = await env.DB.prepare(
        "SELECT * FROM shipments WHERE provider_id IS NOT NULL AND state NOT IN ('cancelled','delivered') AND updated_at<? ORDER BY updated_at LIMIT 1",
  )
    .bind(now() - 60)
    .all<Shipment>();
  for (const shipment of shipments.results) {
    try {
      await reconcileShipment(env, shipment);
    } catch {}
    await env.DB.prepare('UPDATE shipments SET updated_at=? WHERE id=?')
      .bind(now(), shipment.id)
      .run();
  }
  return result;
}
