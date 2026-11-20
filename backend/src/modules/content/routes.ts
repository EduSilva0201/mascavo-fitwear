import { Hono } from 'hono';
import type { Env } from '../../env';
import { currentSession, now } from '../auth/session';
import { faqSchema, testimonialSchema } from './schema';

export const publicContent = new Hono<{ Bindings: Env }>();
publicContent.get('/', async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      'SELECT id,author_name,author_detail,quote,avatar_url,rating FROM editorial_testimonials WHERE published=1 ORDER BY sort_order,id',
    ),
    c.env.DB.prepare(
      'SELECT id,question,answer,category FROM editorial_faq WHERE published=1 ORDER BY sort_order,id',
    ),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json({ testimonials: results[0].results, faq: results[1].results });
});
// Mounted within admin: inherits role, verified-account, Origin and CSRF checks.
export const adminContent = new Hono<{ Bindings: Env }>();
const tables = { testimonials: 'editorial_testimonials', faq: 'editorial_faq' } as const;
adminContent.get('/:kind', async (c) => {
  const table = Object.hasOwn(tables, c.req.param('kind'))
    ? tables[c.req.param('kind') as keyof typeof tables]
    : undefined;
  if (!table) return c.json({ error: 'Tipo de conteúdo inválido.' }, 404);
  return c.json({
    items: (await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all()).results,
  });
});
adminContent.post('/:kind/:id', async (c) => {
  const kind = c.req.param('kind') as keyof typeof tables,
    table = Object.hasOwn(tables, kind) ? tables[kind] : undefined;
  if (!table) return c.json({ error: 'Tipo de conteúdo inválido.' }, 404);
  const parsed = (kind === 'testimonials' ? testimonialSchema : faqSchema).safeParse(
    await c.req.json(),
  );
  if (!parsed.success)
    return c.json(
      { error: 'Confira os campos obrigatórios, a imagem e os limites de texto.' },
      400,
    );
  const create = c.req.param('id') === 'new',
    id = create ? crypto.randomUUID() : c.req.param('id');
  if (!/^[a-f0-9-]{36}$/.test(id)) return c.json({ error: 'Identificador inválido.' }, 400);
  const { revision: previous, ...data } = parsed.data;
  const revision = crypto.randomUUID(),
    time = now();
  const entries = Object.entries(data).map(
    ([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value] as const,
  );
  const columns = entries.map(([key]) => key),
    values = entries.map(([, value]) => value);
  const write = create
    ? c.env.DB.prepare(
        `INSERT INTO ${table}(id,${columns.join(',')},revision,updated_at) VALUES (${Array(
          columns.length + 3,
        )
          .fill('?')
          .join(',')})`,
      ).bind(id, ...values, revision, time)
    : c.env.DB.prepare(
        `UPDATE ${table} SET ${columns.map((key) => key + '=?').join(',')},revision=?,updated_at=? WHERE id=? AND revision=?`,
      ).bind(...values, revision, time, id, previous || '');
  const result = await c.env.DB.batch([
    write,
    c.env.DB.prepare(
      `INSERT INTO admin_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND revision=?)`,
    ).bind(
      crypto.randomUUID(),
      (await currentSession(c))!.customer.id,
      kind + '.' + (create ? 'create' : 'update'),
      id,
      time,
      id,
      revision,
    ),
  ]);
  if (!result[0].meta.changes)
    return c.json(
      { error: 'Conteúdo alterado em outra aba ou não encontrado. Recarregue antes de salvar.' },
      409,
    );
  return c.json({ id, revision, message: 'Conteúdo salvo.' });
});
