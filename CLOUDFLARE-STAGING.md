# Homologação Cloudflare

Ambiente separado de localhost e de produção. Apenas dados fictícios. Asaas e Melhor Envio permanecem com hosts sandbox fixados no código.

## Publicação em 19/11/2026

- Worker `mascavo-fitwear-staging` publicado em `https://teste.mascavofit.com.br`, versão `d538d01a-ca6a-4aaf-be73-3dd892d80e3a`.
- A zona usa os nameservers da Cloudflare, e o subdomínio responde no DNS público. O D1 de homologação está com todas as migrações aplicadas.
- O acesso HTTP Basic foi configurado no deploy. As credenciais locais ficam em `.wrangler/staging-access.json`, ignorado pelo Git.
- A configuração dos provedores sandbox e de seus webhooks segue pendente.

## Preparação realizada em 15/11/2026

- D1 criado: `mascavo-staging`, ID `cce9cf51-34b2-4649-8f09-f57ce802162a`; migrações 0001 a 0013 aplicadas.
- R2 criado: `mascavo-images-staging`.
- Configuração de trabalho: `wrangler.staging.jsonc`; endereço definido como `https://teste.mascavofit.com.br`.
- Build e dry-run do Worker concluídos. Nenhum Worker ou domínio foi publicado nesta preparação.
- A senha de acesso restrito e os secrets sandbox ainda precisam ser definidos no Worker antes da disponibilização.
- Consulta de 15/11/2026: a zona `mascavofit.com.br` não aparece na conta Cloudflare autenticada. Os servidores DNS públicos são `a.auto.dns.br` e `b.auto.dns.br` (Registro.br). Conectar a zona à conta antes de publicar o Custom Domain. Revisar e preservar registros existentes, especialmente de e-mail, antes de alterar nameservers. Nenhuma alteração de DNS foi realizada.

## Configuração e publicação

1. Usar um subdomínio de testes na conta Cloudflare, sem alterar o domínio principal.
2. Criar D1 `mascavo-staging` e R2 `mascavo-images-staging`. Não copiar o banco local, sessões, tokens ou clientes.
3. Copiar `wrangler.staging.example.jsonc` para `wrangler.staging.jsonc`; preencher domínio, origem e ID do novo D1. Confirmar CEP e identificação do aplicativo de frete.
4. Aplicar as migrações no novo banco:

   `npx.cmd wrangler d1 migrations apply mascavo-staging --remote --config wrangler.staging.jsonc`

5. Configurar secrets com `npx.cmd wrangler secret put NOME --config wrangler.staging.jsonc`:
   - `STAGING_USERNAME` e `STAGING_PASSWORD` (senha aleatória de pelo menos 24 caracteres, ASCII).
   - `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN`, exclusivamente de sandbox.
   - Tokens e credenciais do aplicativo sandbox Melhor Envio, quando disponíveis.
   - `COMMERCE_MAINTENANCE_TOKEN`, caso se utilize o endpoint manual de manutenção.
6. Executar `npm.cmd run check` e `npm.cmd run assets:prepare`.
7. Validar o pacote: `npx.cmd wrangler deploy --dry-run --config wrangler.staging.jsonc`.
8. Publicar: `npx.cmd wrangler deploy --config wrangler.staging.jsonc`.

O acesso ao site e às APIs exige autenticação HTTP Basic sobre HTTPS, além do login normal da loja para operações autenticadas. Os dois endpoints POST de webhook são acessíveis aos provedores e continuam exigindo token Asaas ou assinatura Melhor Envio. Nenhum outro caminho ignora a senha de homologação.

Todas as respostas de homologação recebem `X-Robots-Tag: noindex, nofollow, noarchive` e `Cache-Control: no-store`. O Worker aceita apenas a origem HTTPS configurada. `workers.dev` e URLs de preview ficam desativadas.

O cron executa a manutenção a cada minuto, sem depender do terminal. Não compra etiquetas automaticamente.

## Limitações deste primeiro deploy

- Confirmação e recuperação por e-mail ainda não enviam mensagens. A caixa `/api/v1/dev/mail` fica bloqueada remotamente. Implementar um provedor de e-mail antes de usar o cadastro como fluxo completo.
- A caixa administrativa de notificações de pedidos continua simulada.
- Credenciais de produção, venda real e dados pessoais reais não devem ser usados.
- Configurar novamente os URLs HTTPS de webhook nos painéis sandbox após publicar.
- Administração exige promoção explícita de um usuário de teste no banco de homologação, sem reutilizar sessões locais.
- Políticas, retenção, restauração de backup e homologação operacional continuam pendentes para lançamento comercial.

## Verificação após deploy

Sem senha: página inicial e APIs retornam 401; com senha: loja carrega e health informa `staging`, `sandbox` e `production: false`. A caixa de e-mail de desenvolvimento retorna 404 mesmo com senha. Webhooks sem autenticação do provedor falham. Verificar catálogo, imagens, cookies seguros, painel, cron e integrações sandbox no domínio final de homologação.
