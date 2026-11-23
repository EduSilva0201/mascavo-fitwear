import { pilotConfigured } from './commerce-environment';
import { currentSession, type Ctx } from './modules/auth/session';

export async function isCheckoutPilot(c: Ctx, session?: Awaited<ReturnType<typeof currentSession>>) {
  if (!pilotConfigured(c.env)) return false;
  const customer = (session ?? await currentSession(c))?.customer;
  if (!customer?.emailVerified || customer.email !== c.env.CHECKOUT_PILOT_EMAIL) return false;
  return Boolean(await c.env.DB.prepare("SELECT 1 FROM customers WHERE id=? AND role='admin' AND status='active'")
    .bind(customer.id).first());
}
