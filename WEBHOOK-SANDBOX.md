# Asaas Sandbox com Cloudflare Tunnel

O receptor persiste eventos PAYMENT_* com ID unico e concilia pagamentos dos
pedidos. Consulte COMMERCE-SANDBOX.md para o fluxo completo e o worker local.
O proxy publica POST /api/v1/webhooks/asaas, POST /api/v1/webhooks/melhorenvio e as duas paginas GET do Melhor Envio
descritas abaixo; outras rotas retornam 404.

Preparacao: npm.cmd run db:migrate e definir ASAAS_WEBHOOK_TOKEN em .dev.vars
(segredo aleatorio de 32 a 255 caracteres, diferente da chave de API).

Mantenha tres terminais abertos na raiz do projeto:

```powershell
npm.cmd run dev
```

```powershell
node scripts/webhook-proxy.mjs
```

```powershell
.\.wrangler\tools\cloudflared.exe tunnel --url http://127.0.0.1:8788 --no-autoupdate
```

O executavel oficial foi baixado para .wrangler/tools (ignorado pelo Git).
Cadastre https://<endereco-impresso>.trycloudflare.com/api/v1/webhooks/asaas
no Asaas Sandbox. Copie o valor de ASAAS_WEBHOOK_TOKEN para o token de
autenticacao do cadastro. Selecione somente eventos de pagamentos.
Confira as entregas em Integracoes > Logs de Webhooks no Asaas.

O endereco muda a cada inicio do Quick Tunnel. O computador, backend,
proxy e tunel precisam permanecer ligados. Encerre com Ctrl+C.

Teste: npm.cmd run test:webhooks.

Referencias:
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook

## Melhor Envio Sandbox

Use o mesmo dominio ativo do tunel com estes caminhos:

- Ambiente para testes: /integracoes/melhorenvio
- Redirecionamento apos autorizacao: /integracoes/melhorenvio/callback

A pagina de testes apresenta a integracao. O checkout completo permanece local.
O callback sem parametros apresenta instrucoes; nao indica uma conexao concluida.

Apos cadastrar o aplicativo, preencha em .dev.vars:

```text
MELHOR_ENVIO_CLIENT_ID=<ID do app Sandbox>
MELHOR_ENVIO_CLIENT_SECRET=<segredo do app Sandbox>
MELHOR_ENVIO_REDIRECT_URI=https://<dominio-ativo>/integracoes/melhorenvio/callback
MELHOR_ENVIO_USER_AGENT="Mascavo Fitwear (seu-email-de-contato)"
```

Execute `npm.cmd run melhorenvio:authorize` localmente e abra o link impresso em
ate 10 minutos. O inicio nao fica disponivel publicamente. A autorizacao solicita
os escopos de cotacao, carrinho e expedicao. O callback valida state, usa cada tentativa uma vez e
troca o codigo no Sandbox. Tokens sao salvos somente em .dev.vars, ignorado pelo
Git, preservando as demais credenciais. Reinicie o backend depois da autorizacao.
Nao compartilhe Client Secret nem tokens em capturas de tela.

A renovacao automatica utiliza o refresh token e persiste as credenciais rotacionadas
no D1 local. Resultados ambiguos exigem nova autorizacao. Se o dominio do tunel mudar, atualize o aplicativo
e MELHOR_ENVIO_REDIRECT_URI antes de iniciar uma nova autorizacao.

Referencia: https://docs.melhorenvio.com.br/reference/fluxo-de-autoriza%C3%A7%C3%A3o
