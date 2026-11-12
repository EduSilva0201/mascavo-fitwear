import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { currentSession, now } from './session';

function validCpf(value: string) {
  if (!value) return true;
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(value[i]) * (length + 1 - i);
    const digit = (sum * 10) % 11;
    if ((digit === 10 ? 0 : digit) !== Number(value[length])) return false;
  }
  return true;
}
const digits = z.string().max(30).transform(v => v.replace(/\D/g, ''));
const profileSchema = z.object({
 name: z.string().trim().min(3).max(100),
 cpf: digits.refine(validCpf),
 phone: digits.refine(v => !v || /^\d{10,11}$/.test(v)),
}).strict();
const text = (max: number) => z.string().trim().min(1).max(max);
const addressSchema = z.object({
 id: z.string().uuid().optional(), label: text(40), recipient: text(100),
 cep: digits.refine(v => /^\d{8}$/.test(v)), street: text(150), number: text(20),
 complement: z.string().trim().max(100), neighborhood: text(100), city: text(100),
 state: z.enum(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']),
}).strict();
const profile = new Hono<{ Bindings: Env }>();
// Mounted under auth; writes inherit its Origin, CSRF and content-type protection.
profile.use('*', async (c, next) => {
 const session = await currentSession(c);
 if (!session) return c.json({ error: 'Entre na sua conta para continuar.' }, 401);
 await next();
});
profile.get('/', async c => {
 const id = (await currentSession(c))!.customer.id;
 const data = await c.env.DB.prepare('SELECT c.name,c.email,COALESCE(p.cpf,\'\') cpf,COALESCE(p.phone,\'\') phone FROM customers c LEFT JOIN customer_profiles p ON p.customer_id=c.id WHERE c.id=?').bind(id).first();
 const addresses = await c.env.DB.prepare('SELECT id,label,recipient,cep,street,number,complement,neighborhood,city,state FROM customer_addresses WHERE customer_id=? ORDER BY updated_at DESC,id').bind(id).all();
 return c.json({ profile: data, addresses: addresses.results });
});
profile.post('/', async c => {
 const parsed = profileSchema.safeParse(await c.req.json());
 if (!parsed.success) return c.json({ error: 'Confira o nome, CPF e telefone com DDD. CPF e telefone podem ficar em branco.' }, 400);
 const { name, cpf, phone } = parsed.data, id = (await currentSession(c))!.customer.id, time = now();
 await c.env.DB.batch([
  c.env.DB.prepare('UPDATE customers SET name=?,updated_at=? WHERE id=?').bind(name,time,id),
  c.env.DB.prepare('INSERT INTO customer_profiles(customer_id,cpf,phone,updated_at) VALUES (?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET cpf=excluded.cpf,phone=excluded.phone,updated_at=excluded.updated_at').bind(id,cpf,phone,time),
 ]);
 return c.json({ message: 'Seus dados foram salvos.' });
});
profile.post('/addresses', async c => {
 const parsed = addressSchema.safeParse(await c.req.json());
 if (!parsed.success) return c.json({ error: 'Confira os campos do endereco, CEP com 8 digitos e UF.' }, 400);
 const a = parsed.data, owner = (await currentSession(c))!.customer.id;
 if (a.id) {
  const result = await c.env.DB.prepare('UPDATE customer_addresses SET label=?,recipient=?,cep=?,street=?,number=?,complement=?,neighborhood=?,city=?,state=?,updated_at=? WHERE id=? AND customer_id=?').bind(a.label,a.recipient,a.cep,a.street,a.number,a.complement,a.neighborhood,a.city,a.state,now(),a.id,owner).run();
  if (!result.meta.changes) return c.json({ error: 'Endereco nao encontrado.' },404);
 } else {
  const result = await c.env.DB.prepare('INSERT INTO customer_addresses(id,customer_id,label,recipient,cep,street,number,complement,neighborhood,city,state,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM customer_addresses WHERE customer_id=?) < 10').bind(crypto.randomUUID(),owner,a.label,a.recipient,a.cep,a.street,a.number,a.complement,a.neighborhood,a.city,a.state,now(),owner).run();
  if (!result.meta.changes) return c.json({ error: 'Limite de 10 enderecos atingido.' },400);
 }
 return c.json({ message: 'Endereco salvo.' });
});
profile.post('/addresses/:id/delete', async c => {
 const result = await c.env.DB.prepare('DELETE FROM customer_addresses WHERE id=? AND customer_id=?').bind(c.req.param('id'),(await currentSession(c))!.customer.id).run();
 if (!result.meta.changes) return c.json({ error: 'Endereco nao encontrado.' },404);
 return c.json({ message: 'Endereco removido.' });
});
export default profile;
