import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../support/worker.mjs';

test('PF sender stores only CPF, allows absent IE and rejects simultaneous CPF/CNPJ',async()=>{
 const app=await createWorker();
 try{
  const admin=await app.client({role:'admin'});
  const sender={name:'Remetente Teste',document:'52998224725',phone:'11999999999',email:'loja@example.test',postal_code:'01001000',address:'Praca da Se',number:'100',district:'Se',city:'Sao Paulo',state_abbr:'SP'};
  assert.equal((await admin.call('/api/v1/orders/shipping-settings',sender)).status,200);
  const saved=(await admin.call('/api/v1/orders/shipping-settings')).body.sender;
  assert.equal(saved.document,sender.document);
  assert.equal(saved.company_document,undefined);
  assert.equal(saved.state_register,'');
  assert.equal((await admin.call('/api/v1/orders/shipping-settings',{...sender,company_document:'12345678000195'})).status,400);
  assert.equal((await admin.call('/api/v1/orders/shipping-settings',{...sender,document:'123'})).status,400);
  assert.equal((await (await app.client()).call('/api/v1/orders/shipping-settings',sender)).status,403);
 }finally{await app.dispose();}
});
