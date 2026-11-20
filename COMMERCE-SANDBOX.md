# Pedidos, Asaas e Melhor Envio — Sandbox

O checkout cria pedidos persistentes, com endereço, cliente, preços e frete
congelados. Reserva estoque por 30 minutos em uma transação; tentativas concorrentes
não podem reservar a última peça duas vezes. A expiração devolve estoque uma única
vez. Pagamento recebido depois da expiração fica em revisão, sem liberar expedição.

## Operação local

1. Execute `npm.cmd run db:migrate`.
2. Mantenha `npm.cmd run dev`, `npm.cmd run sandbox:proxy`, o Cloudflare Tunnel
   e `npm.cmd run commerce:worker` em execução.
3. Configure no `.dev.vars` as credenciais Sandbox e um
   `COMMERCE_MAINTENANCE_TOKEN` aleatório de pelo menos 32 caracteres.
4. Cadastre CPF, telefone e endereço fictícios em Minha conta. Escolha o endereço,
   consulte o frete e continue para o pagamento. A sacola cria `POST /api/v1/orders`.
5. Consulte Meus pedidos ou o painel administrativo em Pedidos e envios.

O worker local expira reservas, reprocessa eventos pendentes, consulta pagamentos
e recupera atualizações de entrega que não chegaram por webhook. Ele atende
somente em localhost, com token dedicado; seu endpoint não é publicado pelo proxy.
As consultas são limitadas por ciclo. Não compra etiquetas automaticamente.

## Pagamento

O Asaas é consultado antes de liberar uma operação de expedição. Titular,
referência, valor total, unicidade e grupo das parcelas devem coincidir com o
pedido. Todas as parcelas precisam estar confirmadas ou recebidas. Estornos,
estornos parciais e contestações bloqueiam a expedição; não devolvem automaticamente
estoque de uma mercadoria que pode já ter sido enviada.

O webhook autentica `asaas-access-token`, grava o evento antes de responder e
processa depois. A repetição do mesmo ID não gera outro efeito. Eventos antigos
não substituem um pagamento confirmado por um estado pendente. Falhas transitórias
ficam persistidas para o worker repetir a consulta, sem repetir cobranças.

## Remetente, nota fiscal e etiquetas

No painel:

- **Remetente e pacotes**: informe CNPJ, inscrição estadual, contato e endereço;
  cadastre peso e medidas de cada variante em kg e cm. Depois faça nova cotação.
- **Pedidos e envios**: abra o pedido, consulte o pagamento, informe a chave de
  44 dígitos da nota fiscal e prepare a expedição.
- Use as ações na ordem: criar carrinho, comprar, gerar e imprimir. A consulta de
  entrega confirma cada etapa. O link de impressão é privado no Melhor Envio.

Nota fiscal, remetente e dimensões verificadas são obrigatórios. Nenhuma nota
fiscal é emitida por este sistema: a chave é fornecida pelo responsável da loja.
O fluxo implementado exige cotação de um único pacote; múltiplos volumes são
bloqueados para revisão e não são convertidos em medidas inventadas.

O ID de etiqueta e as operações são persistidos antes das próximas etapas.
Timeout ou falha ambígua deixam a operação em revisão, sem compra automática
duplicada. Uma leitura com estado `pending` não é prova suficiente para repetir
uma compra de resultado desconhecido. Recusas explícitas podem ser corrigidas
e repetidas após consultar a etiqueta. Se o ID de um carrinho foi perdido, confira
o painel do provedor antes de qualquer nova emissão.

Cancelar conserva a etiqueta original. Após confirmação do cancelamento, uma
nova preparação cria outra sequência. Etiqueta gerada não significa encomenda
postada. Rastreio ausente aparece como aguardando transportadora.

## Aplicativo e webhooks do Melhor Envio

Preencha `MELHOR_ENVIO_CLIENT_ID` e `MELHOR_ENVIO_CLIENT_SECRET` em `.dev.vars`.
Mantenha `MELHOR_ENVIO_REDIRECT_URI` idêntico ao cadastro e execute
`npm.cmd run melhorenvio:authorize`. Autorize os escopos de cotação, carrinho,
consulta, compra, geração, impressão, cancelamento e rastreio.

Após a autorização, os tokens são salvos localmente. Reinicie o backend para
carregar a configuração. A renovação OAuth é automática: tokens rotacionados
ficam no D1 local, sem exposição em respostas. Um refresh de resultado ambíguo
exige nova autorização, em vez de reutilizar cegamente um refresh token.

No aplicativo Sandbox, cadastre também o webhook:

```text
https://<domínio-ativo-do-túnel>/api/v1/webhooks/melhorenvio
```

A assinatura `X-ME-Signature` é HMAC-SHA256 em Base64 do corpo original, usando
o Client Secret. Etiquetas de outra aplicação não são aceitas. Webhooks do
Melhor Envio só cobrem etiquetas geradas pelo mesmo aplicativo autorizado.

## E-mails e limites da homologação

Conforme o escopo escolhido, os e-mails usam exclusivamente uma caixa local,
acessível em **E-mails de teste** no painel. Pedido, pagamento, postagem, rastreio,
entrega e exceções geram registros únicos. Persistência e entrega local ocorrem
com proteção contra duplicidade e retentativas de falhas do armazenamento.
Nenhuma mensagem é enviada a destinatários reais. Provedor, domínio e rotina
de envio externo continuam fora deste escopo; timeouts de um provedor de e-mail
não são simulados como se houvesse uma integração externa implementada.

Os testes automatizados em `tests/integration/commerce.test.mjs` substituem o
inventário anterior de TODOs para pedidos, pagamentos, etiquetas e notificações
locais. Os testes em `shipping-oauth.test.mjs` verificam a renovação de tokens.
APIs simuladas não homologam o ciclo de etiquetas no serviço real: isso ainda
depende das credenciais do aplicativo e dos dados fiscais e de expedição.

Os hosts continuam fixados nos Sandboxes. Este trabalho não publica checkout
de produção nem cria envios transportáveis fora do ambiente de testes.

Referências oficiais:
- https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- https://docs.asaas.com/docs/criar-uma-cobranca-parcelada
- https://docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho
- https://docs.melhorenvio.com.br/docs/webhooks
