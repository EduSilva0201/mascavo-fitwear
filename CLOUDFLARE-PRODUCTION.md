# Produção Mascavo Fitwear

A configuração `wrangler.production.jsonc` usa o Worker `mascavo-fitwear-production`, o D1 `mascavo-production` e o R2 `mascavo-images-production`. O domínio oficial atende a loja e o webhook do Asaas. O checkout vem fechado. A homologação usa recursos e credenciais próprios.

## Conectar os provedores

1. No Asaas de produção da Mascavo, habilite os meios de pagamento aprovados pela loja. Cadastre `ASAAS_API_KEY` como secret no Worker de produção. O Worker usa `api.asaas.com` em produção e mantém o checkout hospedado pelo Asaas.
2. Na mesma conta Asaas, crie o webhook em `https://mascavofit.com.br/api/v1/webhooks/asaas`. Grave o token de autenticação do webhook, com pelo menos 32 caracteres, como `ASAAS_WEBHOOK_TOKEN`. Inclua eventos de confirmação, recebimento, vencimento, estorno e contestação usados na operação.
3. No Resend, verifique o domínio do remetente e configure `ORDER_EMAIL_FROM` e `RESEND_API_KEY` como secrets no Worker de produção. Confirmação de cadastro, recuperação de senha e e-mails de pedido têm como destino o endereço do cliente.

## Preparar a loja

- Cadastre e confirme o e-mail da pessoa administradora. Conceda o papel de administrador no D1 de produção à conta confirmada.
- Aprove e publique produtos, fotos, preços e quantidades reais. Os registros iniciais de catálogo ficam em rascunho até serem revisados.
- Configure o contato da loja, as informações da empresa, atendimento, privacidade, cancelamentos e a política de entrega.
- Defina `DELIVERY_CEP_PREFIXES` (prefixos de CEP permitidos separados por vírgula), `DELIVERY_FEE_CENTS` (valor fixo por pedido, use `0` para entrega gratuita) e `DELIVERY_ESTIMATE` (prazo que aparece antes de pagar). Use essas opções somente se uma tarifa fixa atender às regiões aprovadas.
- A configuração inicial permite Pix. Ajuste `ASAAS_PAYMENT_METHODS` após confirmar boleto ou cartão com a loja e testar cada fluxo. A produção reserva o estoque por quatro dias enquanto aguarda pagamento. Pagamentos posteriores à liberação da reserva ficam em revisão.

## Publicar e validar

1. Rode `npm.cmd run typecheck` e `npm.cmd run assets:prepare`. Aplique migrações com `npx.cmd wrangler d1 migrations apply mascavo-production --remote --config wrangler.production.jsonc`.
2. Valide o build com `npx.cmd wrangler deploy --dry-run --config wrangler.production.jsonc`. Publique com o mesmo comando sem `--dry-run`, mantendo `CHECKOUT_ENABLED=false`.
3. Anexe o domínio confirmado e valide vitrine, conta, e-mails e painel com o checkout fechado. Confira se a URL de webhook responde ao Asaas.
4. Na janela combinada de teste, habilite `CHECKOUT_ENABLED=true` e faça uma compra controlada. Confira preço e entrega, retorno do Asaas, webhook, estoque, e-mails, painel e cancelamento ou estorno. Se for necessário interromper novos pedidos, volte o interruptor para `false`. O webhook e a manutenção continuam atendendo os pedidos já registrados.
