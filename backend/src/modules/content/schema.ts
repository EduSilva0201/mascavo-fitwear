import { z } from 'zod';
import { mediaPath } from '../admin/schema';
const base = {
  published: z.boolean(),
  sort_order: z.number().int().min(0).max(10000),
  revision: z.string().max(64).optional(),
};
const text = (max: number) => z.string().trim().min(1).max(max);
export const testimonialSchema = z
  .object({
    ...base,
    author_name: text(100),
    author_detail: z.string().trim().max(100),
    quote: text(1500),
    avatar_url: z.union([z.literal(''), mediaPath]),
    rating: z.number().int().min(1).max(5).nullable(),
  })
  .strict();
export const faqSchema = z
  .object({ ...base, question: text(200), answer: text(4000), category: text(60) })
  .strict();
