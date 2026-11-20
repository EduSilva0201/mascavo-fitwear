import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../../env';
import { currentSession, csrfCookie, now } from '../auth/session';
import { equal } from '../auth/crypto';
import { productSchema, settingsSchema } from './schema';
import { adminContent } from '../content/routes';

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', async (c, next) => {
  const session = await currentSession(c);
  if (!session) return c.json({ error: 'Entre com sua conta de administrador.' }, 401);
  const user = await c.env.DB.prepare(
    "SELECT role FROM customers WHERE id=? AND status='active' AND email_verified_at IS NOT NULL",
  )
    .bind(session.customer.id)
    .first<{ role: string }>();
  if (user?.role !== 'admin')
    return c.json({ error: 'Esta conta não tem acesso administrativo.' }, 403);
  if (c.req.method !== 'GET') {
    const token = getCookie(c, csrfCookie(c)) || '';
    if (
      c.req.header('Origin') !== c.env.APP_ORIGIN ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !equal(token, c.req.header('X-CSRF-Token') || '')
    )
      return c.json({ error: 'Atualize a página e tente novamente.' }, 403);
    if (
      !c.req.path.endsWith('/media') &&
      !c.req.header('Content-Type')?.startsWith('application/json')
    )
      return c.json({ error: 'Envie JSON.' }, 415);
  }
  await next();
});
admin.get('/session', (c) => c.json({ admin: true }));
admin.get('/catalog', async (c) => {
  const result = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT * FROM catalog_products ORDER BY sort_order,id'),
    c.env.DB.prepare('SELECT * FROM catalog_variants ORDER BY sort_order'),
    c.env.DB.prepare('SELECT * FROM catalog_images ORDER BY sort_order'),
    c.env.DB.prepare('SELECT * FROM catalog_categories ORDER BY sort_order'),
  ]);
  return c.json({
    products: result[0].results.map((p) => ({
      ...p,
      variants: result[1].results.filter((v) => v.product_id === p.id),
      images: result[2].results.filter((i) => i.product_id === p.id),
    })),
    categories: result[3].results,
  });
});
admin.post('/products/:id', async (c) => {
  const parsed = productSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
  const p = parsed.data,
    create = c.req.param('id') === 'new';
  const id = create
    ? crypto.getRandomValues(new Uint32Array(1))[0] + 100
    : Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: 'Produto inválido.' }, 400);
  if (
    !(await c.env.DB.prepare('SELECT name FROM catalog_categories WHERE name=?')
      .bind(p.category)
      .first())
  )
    return c.json({ error: 'Selecione uma categoria cadastrada.' }, 400);
  const revision = crypto.randomUUID();
  const statements = [
    create
      ? c.env.DB.prepare(
          'INSERT INTO catalog_products(id,name,category,description,price_cents,provisional,active,sort_order,revision) VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(
          id,
          p.name,
          p.category,
          p.description,
          p.price_cents,
          +p.provisional,
          +p.active,
          p.sort_order,
          revision,
        )
      : c.env.DB.prepare(
          'UPDATE catalog_products SET name=?,category=?,description=?,price_cents=?,provisional=?,active=?,sort_order=?,revision=? WHERE id=? AND revision=?',
        ).bind(
          p.name,
          p.category,
          p.description,
          p.price_cents,
          +p.provisional,
          +p.active,
          p.sort_order,
          revision,
          id,
          p.revision || '',
        ),
  ];
  const guard = 'EXISTS(SELECT 1 FROM catalog_products WHERE id=? AND revision=?)';
  statements.push(
    c.env.DB.prepare(`DELETE FROM catalog_variants WHERE product_id=? AND ${guard}`).bind(
      id,
      id,
      revision,
    ),
  );
  statements.push(
    c.env.DB.prepare(`DELETE FROM catalog_images WHERE product_id=? AND ${guard}`).bind(
      id,
      id,
      revision,
    ),
  );
  p.variants.forEach((v, i) =>
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO catalog_variants(product_id,color,size,stock,image_url,sort_order,color_hex) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      ).bind(id, v.color, v.size, v.stock, v.image_url, i, v.color_hex || null, id, revision),
    ),
  );
  p.images.forEach((im, i) =>
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO catalog_images(product_id,sort_order,src,label,color) SELECT ?,?,?,?,? WHERE ${guard}`,
      ).bind(id, i, im.src, im.label, im.color, id, revision),
    ),
  );
  statements.push(
    c.env.DB.prepare(`INSERT INTO admin_audit SELECT ?,?,?,?,? WHERE ${guard}`).bind(
      crypto.randomUUID(),
      (await currentSession(c))!.customer.id,
      create ? 'product.create' : 'product.update',
      String(id),
      now(),
      id,
      revision,
    ),
  );
  const result = await c.env.DB.batch(statements);
  if (!result[0].meta.changes)
    return c.json(
      { error: 'Este produto foi alterado em outra aba. Recarregue antes de editar.' },
      409,
    );
  return c.json({ id, revision, message: 'Produto salvo.' });
});
admin.post('/categories', async (c) => {
  const parsed = z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[\p{L}\p{N} ._-]+$/u),
    })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Nome de categoria inválido.' }, 400);
  const result = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO catalog_categories(name,sort_order) VALUES (?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM catalog_categories))',
  )
    .bind(parsed.data.name)
    .run();
  return c.json({
    message: result.meta.changes ? 'Categoria criada.' : 'Categoria já cadastrada.',
  });
});
admin.post('/categories/manage', async (c) => {
  const nameSchema = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\p{L}\p{N} ._-]+$/u);
  const parsed = z
    .object({
      name: nameSchema,
      action: z.enum(['rename', 'delete']),
      newName: nameSchema.optional(),
    })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Categoria inválida.' }, 400);
  const { name, action, newName } = parsed.data;
  if (
    !(await c.env.DB.prepare('SELECT name FROM catalog_categories WHERE name=?').bind(name).first())
  )
    return c.json({ error: 'Categoria não encontrada.' }, 404);
  if (action === 'delete') {
    const result = await c.env.DB.prepare(
      'DELETE FROM catalog_categories WHERE name=? AND NOT EXISTS(SELECT 1 FROM catalog_products WHERE category=?)',
    )
      .bind(name, name)
      .run();
    if (!result.meta.changes)
      return c.json({ error: 'Mova os produtos desta categoria antes de removê-la.' }, 409);
  } else {
    if (!newName || newName === name) return c.json({ error: 'Informe um nome diferente.' }, 400);
    if (
      await c.env.DB.prepare('SELECT name FROM catalog_categories WHERE name=?')
        .bind(newName)
        .first()
    )
      return c.json({ error: 'Já existe uma categoria com este nome.' }, 409);
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO catalog_categories(name,sort_order) SELECT ?,sort_order FROM catalog_categories WHERE name=?',
      ).bind(newName, name),
      c.env.DB.prepare('UPDATE catalog_products SET category=?,revision=? WHERE category=?').bind(
        newName,
        crypto.randomUUID(),
        name,
      ),
      c.env.DB.prepare('DELETE FROM catalog_categories WHERE name=?').bind(name),
    ]);
  }
  await c.env.DB.prepare('INSERT INTO admin_audit VALUES (?,?,?,?,?)')
    .bind(
      crypto.randomUUID(),
      (await currentSession(c))!.customer.id,
      'category.' + action,
      name,
      now(),
    )
    .run();
  return c.json({ message: 'Categoria atualizada.' });
});
admin.get('/settings', async (c) =>
  c.json(await c.env.DB.prepare('SELECT data,revision FROM store_settings WHERE id=1').first()),
);
admin.post('/settings', async (c) => {
  const parsed = z
    .object({ data: settingsSchema, revision: z.string().max(64) })
    .strict()
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Confira os campos de contato e os textos.' }, 400);
  const revision = crypto.randomUUID();
  const result = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE store_settings SET data=?,revision=? WHERE id=1 AND revision=?').bind(
      JSON.stringify(parsed.data.data),
      revision,
      parsed.data.revision,
    ),
    c.env.DB.prepare(
      'INSERT INTO admin_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM store_settings WHERE id=1 AND revision=?)',
    ).bind(
      crypto.randomUUID(),
      (await currentSession(c))!.customer.id,
      'settings.update',
      'store',
      now(),
      revision,
    ),
  ]);
  if (!result[0].meta.changes)
    return c.json({ error: 'Configurações alteradas em outra aba. Recarregue.' }, 409);
  return c.json({ revision, message: 'Configurações salvas.' });
});
admin.get('/audit', async (c) =>
  c.json({
    entries: (
      await c.env.DB.prepare(
        'SELECT a.action,a.target,a.created_at,c.name FROM admin_audit a JOIN customers c ON c.id=a.actor_id ORDER BY created_at DESC LIMIT 100',
      ).all()
    ).results,
  }),
);
admin.get('/media', async (c) =>
  c.json({
    media: (
      await c.env.DB.prepare(
        'SELECT key,mime,size,created_at FROM admin_media ORDER BY created_at DESC LIMIT 200',
      ).all()
    ).results,
  }),
);
admin.post('/media', async (c) => {
  const mime = c.req.header('Content-Type') || '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime))
    return c.json({ error: 'Envie uma imagem PNG, JPG ou WebP.' }, 400);
  const data = await c.req.arrayBuffer();
  if (data.byteLength > 5 * 1024 * 1024 || data.byteLength < 12)
    return c.json({ error: 'Imagem inválida ou maior que 5 MB.' }, 400);
  const b = new Uint8Array(data);
  const png = b.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const jpg = b[0] === 255 && b[1] === 216 && b[2] === 255;
  const webp =
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  if (!(
    (mime === 'image/png' && png) ||
    (mime === 'image/jpeg' && jpg) ||
    (mime === 'image/webp' && webp)
  ))
    return c.json({ error: 'O conteúdo não corresponde ao formato da imagem.' }, 400);
  const key =
    crypto.randomUUID() +
    { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[mime];
  await c.env.IMAGES.put(key, data, { httpMetadata: { contentType: mime } });
  try {
    await c.env.DB.prepare('INSERT INTO admin_media VALUES (?,?,?,?,?)')
      .bind(key, mime, data.byteLength, (await currentSession(c))!.customer.id, now())
      .run();
  } catch (e) {
    await c.env.IMAGES.delete(key);
    throw e;
  }
  return c.json({ src: '/media/' + key }, 201);
});
admin.route('/content',adminContent);
export default admin;
