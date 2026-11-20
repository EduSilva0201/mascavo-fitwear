import { z } from 'zod';

export const paymentChoiceSchema = z.object({
  billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']),
  installments: z.number().int().min(1).max(3),
}).refine(v => v.billingType === 'CREDIT_CARD' || v.installments === 1, {
  message: 'Parcelamento disponível apenas no crédito, em até 3 vezes.',
});

export function paymentAmount(amountCents: number, installments: number) {
  return installments > 1
    ? { installmentCount: installments, totalValue: amountCents / 100 }
    : { value: amountCents / 100 };
}

export function cartSnapshot(items: { id: number; color: string; size: string; qty: number; priceCents: number }[]) {
  return JSON.stringify([...items].sort((a, b) => JSON.stringify([a.id, a.color, a.size]).localeCompare(JSON.stringify([b.id, b.color, b.size]))));
}
