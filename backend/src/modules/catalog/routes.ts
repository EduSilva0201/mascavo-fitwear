import { Hono } from 'hono';
import type { Env } from '../../env';

type Product = { id: number; name: string; category: string; description: string; price_cents: number; provisional: number };
type Variant = { product_id: number; color: string; size: string; stock: number; image_url: string };
type Image = { product_id: number; src: string; label: string; color: string | null };
const catalog = new Hono<{ Bindings: Env }>();
catalog.get('/', async (c) => {
  const category = c.req.query('category');
  if (category && category.length > 80) return c.json({ error: 'Categoria invalida.' }, 400);
  const results = await c.env.DB.batch([
    c.env.DB.prepare('SELECT name FROM catalog_categories ORDER BY sort_order'),
    c.env.DB.prepare('SELECT id,name,category,description,price_cents,provisional FROM catalog_products WHERE active=1 AND (? IS NULL OR category=?) ORDER BY sort_order').bind(category ?? null, category ?? null),
    c.env.DB.prepare('SELECT v.* FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE p.active=1 ORDER BY v.sort_order'),
    c.env.DB.prepare('SELECT i.* FROM catalog_images i JOIN catalog_products p ON p.id=i.product_id WHERE p.active=1 ORDER BY i.sort_order'),
  ]);
  const categories = (results[0].results as { name: string }[]).map(row => row.name);
  if (category && !categories.includes(category)) return c.json({ error: 'Categoria nao encontrada.' }, 404);
  const variants = results[2].results as Variant[];
  const images = results[3].results as Image[];
  const products = (results[1].results as Product[]).map(p => {
    const rows = variants.filter(v => v.product_id === p.id);
    const stock: Record<string, Record<string, number>> = {};
    const photos: Record<string, string> = {};
    for (const v of rows) {
      (stock[v.color] ??= {})[v.size] = v.stock;
      photos[v.color] = v.image_url;
    }
    return {
      id: p.id, name: p.name, category: p.category, description: p.description,
      price: p.price_cents / 100, priceCents: p.price_cents, provisional: Boolean(p.provisional), best: false,
      colors: [...new Set(rows.map(v => v.color))], sizes: [...new Set(rows.map(v => v.size))], images: photos, stock,
      gallery: images.filter(i => i.product_id === p.id).map(i => ({ src: i.src, label: i.label, ...(i.color ? { color: i.color } : {}) })),
    };
  });
  return c.json({ categories, products });
});
export default catalog;
