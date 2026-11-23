import { z } from 'zod';
// The existing storefront builds HTML. Keep editable catalog values plain text.
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[<>"'&]/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v),
      'Use texto simples, sem HTML, aspas ou &.',
    );
export const mediaPath = z
  .string()
  .max(240)
  .regex(/^(?:assets\/testimonials\/avatar-(?:ana|beatriz|camila)\.svg|assets\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)|\/media\/[a-f0-9-]+\.(?:png|jpg|webp))$/)
  .refine((v) => !v.includes('..'));
export const productSchema = z
  .object({
    name: text(100),
    category: text(80),
    description: text(2000),
    price_cents: z.number().int().min(1).max(10000000),
    active: z.boolean(),
    provisional: z.boolean(),
    sort_order: z.number().int().min(0).max(10000),
    revision: z.string().max(64).optional(),
    variants: z
      .array(
        z
          .object({
            color: text(60),
            size: text(20),
            stock: z.number().int().min(0).max(100000),
            image_url: mediaPath,
            color_hex: z
              .string()
              .regex(/^#[a-fA-F0-9]{6}$/)
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    images: z
      .array(z.object({ src: mediaPath, label: text(100), color: text(60).nullable() }).strict())
      .min(1)
      .max(24),
  })
  .strict()
  .superRefine((p, ctx) => {
    const keys = p.variants.map((v) => `${v.color}\0${v.size}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'Cor e tamanho repetidos.' });
    const colors = new Set(p.variants.map((v) => v.color));
    if (p.images.some((i) => i.color && !colors.has(i.color)))
      ctx.addIssue({ code: 'custom', message: 'A cor da foto precisa existir nas variantes.' });
  });
export const settingsSchema = z
  .object({
    storeName: text(80),
    tagline: text(150),
    contactEmail: z.union([z.literal(''), z.string().email().max(254)]),
    whatsapp: z.string().regex(/^(?:\d{10,13})?$/),
    instagram: z.string().regex(/^[a-zA-Z0-9_.]{0,40}$/),
    announcement: z
      .string()
      .trim()
      .max(180)
      .refine((v) => !/[<>"'&]/.test(v)),
    heroTitle1: text(100).optional(),
    heroText1: text(200).optional(),
    heroImage1: mediaPath.optional(),
    heroTitle2: text(100).optional(),
    heroText2: text(200).optional(),
    heroImage2: mediaPath.optional(),
    deliveryPolicy: z.string().trim().max(500).optional(),
    orderWhatsAppMessage: z.string().trim().max(500).optional(),
    shippingOriginCep: z
      .string()
      .regex(/^\d{8}$/)
      .optional(),
    shippingWeightKg: z.number().positive().max(30).optional(),
    shippingWidthCm: z.number().positive().max(200).optional(),
    shippingHeightCm: z.number().positive().max(200).optional(),
    shippingLengthCm: z.number().positive().max(200).optional(),
  })
  .strict();
