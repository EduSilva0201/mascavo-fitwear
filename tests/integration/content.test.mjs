import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorker,origin } from '../support/worker.mjs';
let app;
before(async()=>{app=await createWorker();});after(async()=>app?.dispose());
const testimonial={author_name:'Cliente Ficticia',author_detail:'Relato de teste',quote:'Conforto & movimento, com "leveza".',avatar_url:'',rating:null,published:false,sort_order:10};
test('content: public endpoint exposes only published content and no revisions',async()=>{
  const admin=await app.client({role:'admin'});
  const created=await admin.call('/api/v1/admin/content/testimonials/new',testimonial);assert.equal(created.status,200);
  const read=async()=>{const r=await app.runtime.dispatchFetch(origin+'/api/v1/content');assert.equal(r.status,200);return r.json();};
  assert.equal((await read()).testimonials.length,0);assert.equal((await read()).faq.length,3);
  const published=await admin.call('/api/v1/admin/content/testimonials/'+created.body.id,{...testimonial,published:true,revision:created.body.revision});assert.equal(published.status,200);
  const data=await read();assert.equal(data.testimonials[0].quote,testimonial.quote);assert.equal('revision' in data.testimonials[0],false);
  assert.equal((await admin.call('/api/v1/admin/content/testimonials/'+created.body.id,{...testimonial,revision:created.body.revision})).status,409);
  assert.equal((await read()).testimonials.length,1);
  assert.equal((await admin.call('/api/v1/admin/content/testimonials/'+created.body.id,{...testimonial,revision:published.body.revision})).status,200);
  assert.equal((await read()).testimonials.length,0);
});
test('content: demo seed is repeatable, labeled and includes local illustrated avatars',async()=>{
  const sql=(await readFile('backend/seeds/testimonials-demo.sql','utf8')).replace(/^\s*--.*$/gm,'');
  await app.db.prepare(sql).run();await app.db.prepare(sql).run();
  const data=await (await app.runtime.dispatchFetch(origin+'/api/v1/content')).json();
  assert.equal(data.testimonials.length,3);
  for(const item of data.testimonials){assert.match(item.author_detail,/fictício/);assert.match(item.avatar_url,/^assets\/testimonials\/avatar-\w+\.svg$/);}
});
test('content: admin role, origin, CSRF and schemas are required',async()=>{
  const customer=await app.client(),admin=await app.client({role:'admin'});
  assert.equal((await customer.call('/api/v1/admin/content/faq')).status,403);
  assert.equal((await customer.call('/api/v1/admin/content/testimonials/new',testimonial)).status,403);
  assert.equal((await admin.call('/api/v1/admin/content/testimonials/new',testimonial,{'X-CSRF-Token':''})).status,403);
  assert.equal((await admin.call('/api/v1/admin/content/testimonials/new',testimonial,{Origin:'https://attacker.test'})).status,403);
  assert.equal((await admin.call('/api/v1/admin/content/testimonials/new',{...testimonial,rating:6})).status,400);
  assert.equal((await admin.call('/api/v1/admin/content/testimonials/new',{...testimonial,avatar_url:'https://attacker.test/pixel.png'})).status,400);
  assert.equal((await admin.call('/api/v1/admin/content/faq/new',{question:'',answer:'',category:'',published:true,sort_order:0})).status,400);
  assert.equal((await admin.call('/api/v1/admin/content/not-a-table')).status,404);
  assert.equal((await admin.call('/api/v1/admin/content/constructor')).status,404);
});
test('content: FAQ editing, ordering and unpublishing preserve history',async()=>{
  const admin=await app.client({role:'admin'}),body={question:'Pergunta de teste?',answer:'Resposta de teste.\nSegunda linha.',category:'Teste',published:true,sort_order:0};
  const created=await admin.call('/api/v1/admin/content/faq/new',body);assert.equal(created.status,200);
  const updated=await admin.call('/api/v1/admin/content/faq/'+created.body.id,{...body,question:'Pergunta atualizada?',revision:created.body.revision,sort_order:99});assert.equal(updated.status,200);
  let data=(await (await app.runtime.dispatchFetch(origin+'/api/v1/content')).json());assert.equal(data.faq.at(-1).question,'Pergunta atualizada?');
  assert.equal((await admin.call('/api/v1/admin/content/faq/'+created.body.id,{...body,published:false,revision:updated.body.revision})).status,200);
  data=await (await app.runtime.dispatchFetch(origin+'/api/v1/content')).json();assert.equal(data.faq.some(f=>f.id===created.body.id),false);
  const audit=await app.db.prepare('SELECT COUNT(*) n FROM admin_audit WHERE target=?').bind(created.body.id).first();assert.equal(audit.n,3);
});
