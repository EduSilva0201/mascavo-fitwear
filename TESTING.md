# Mascavo — testes automatizados

## Diagnóstico e decisões

O projeto usa Hono em Cloudflare Workers, D1, R2, TypeScript e uma vitrine HTML/JS com ilhas React. Já possuía `node:test`, Playwright, testes de autenticação/administração e seis testes unitários das integrações. Mantivemos essas ferramentas para não trocar infraestrutura funcional por outro framework.

O checkout Sandbox cria pedidos e reservas persistentes, consulta pagamentos Asaas, recebe webhooks autenticados, gerencia etiquetas e concilia entregas Melhor Envio. Notificações transacionais usam caixa local, conforme o escopo escolhido. Consulte [COMMERCE-SANDBOX.md](COMMERCE-SANDBOX.md) para configuração, bloqueios fiscais e limites de homologação.

Tabelas existentes: `customers`, `sessions`, `auth_tokens`, `auth_rate_limits`, `dev_mail`, `customer_profiles`, `customer_addresses`, catálogo (categorias/produtos/variantes/imagens), `sandbox_payments`, `sandbox_shipping_quotes`, `store_settings`, `admin_audit` e `admin_media`. As migrações oficiais são aplicadas no banco de testes; não existe cópia de dados de clientes ou do banco local de desenvolvimento.

Endpoints exercitados incluem `/api/v1/auth/*`, `/catalog`, `/integrations/status`, `/integrations/shipping/quote`, `/integrations/payments`, `/admin/*`, `/store` e `/media/:key`. O estado de pedidos permanece indisponível até a implementação comercial.

## Comandos

No PowerShell use `npm.cmd` no lugar de `npm`, caso a política de execução bloqueie `npm.ps1`.

| Comando | O que executa |
| --- | --- |
| `npm test` | Todos os testes locais, incluindo pedidos, expedição e notificações |
| `npm run check` | TypeScript e todos os testes locais |
| `npm run test:unit` | Clientes HTTP, cálculo de parcelas/fingerprint, timeout e relatórios |
| `npm run test:integration` | Rotas do Worker com Asaas/Melhor Envio simulados e segurança |
| `npm run test:asaas` | Unitários compartilhados e criação de cobranças por API simulada |
| `npm run test:melhorenvio` | Unitários compartilhados e cotações por API simulada |
| `npm run test:security` | Sessão, origem, CSRF, valores, estoque, titularidade e não exposição de segredos |
| `npm run test:e2e` | Navegador, autenticação, catálogo, administração e fluxos atuais |
| `npm run test:checkout` | Fluxos visuais e pedidos até a entrega com provedores simulados |
| `npm run test:webhooks` | Autenticação, persistência, processamento, duplicatas e eventos fora de ordem |
| `npm run test:email` | Notificações e entrega local, junto aos fluxos de pedidos |
| `npm run test:coverage` | Cobertura dos módulos `providers.ts` e `checkout.ts` |
| `npm run test:sandbox` | Apenas conectividade real, após configuração e ativação explícitas |

Use Node 26, a mesma versão definida no CI. Instale as dependências com `npm ci`. Localmente os testes visuais usam Chrome instalado. Para usar Chromium do Playwright:

```powershell
npx.cmd playwright install chromium
$env:PLAYWRIGHT_CHANNEL='chromium'
npm.cmd run check
```

No CI, o navegador e suas dependências são instalados pelo workflow. Os testes locais não requerem conta Cloudflare, token Asaas ou token Melhor Envio.

## Estrutura

```text
tests/
  integrations.test.mjs       # unitários existentes preservados
  auth.test.mjs               # fluxos existentes e navegador preservados
  unit/                      # timeout, validações adicionais, reporter
  integration/               # rotas reais + APIs simuladas
  security/                  # controles de acesso e integridade financeira
  webhooks/                  # autenticação e persistência Asaas
  sandbox/                   # acesso externo somente opt-in
  support/
    worker.mjs               # workerd + D1 em memória + interceptação externa
    wrangler.test.jsonc       # servidor E2E isolado
    browser.mjs              # bloqueio de rede externa no navegador
    report.mjs               # terminal, HTML, JSON, JUnit e LCOV
  scenarios.json             # inventário histórico, substituído por testes de comércio
scripts/test.mjs             # seleção de suítes e relatórios
```

## Isolamento

- Os testes de integração usam o Worker real no Miniflare/workerd com D1/R2 efêmeros, sem persistência e com credenciais falsas.
- Toda chamada externa desse Worker é interceptada. Não há fallback para rede real. Apenas os hosts sandbox e os caminhos simulados definidos no helper são aceitos.
- O E2E usa `tests/support/wrangler.test.jsonc`, portas locais e uma pasta UUID em `.wrangler/tests`. O nome e o identificador do banco são exclusivos de testes, com bindings remotos desabilitados.
- A configuração de teste fica em outra pasta para não carregar o `.dev.vars` de desenvolvimento. Carregamento automático de `.env` é desabilitado. Variáveis de provedores são removidas dos processos locais de teste.
- A navegação externa é bloqueada no navegador. O teste de imagens antigas pode responder com um SVG local simulado, sem rede externa.
- Imagens, relatórios, banco e screenshots de teste ficam em pastas ignoradas pelo Git. A suíte não apaga nem altera o banco de desenvolvimento ou de produção.
- O helper de migrações simuladas aplica os SQL atuais após retirar comentários de linha e separar instruções por `;`. Se futuramente houver triggers ou literais SQL com `;`, adapte esse helper antes de adicionar a migração. O E2E já usa o executor oficial do Wrangler.

## Relatórios

Cada execução escreve em `test-results/reports/<suite>/`:

- `index.html`: relatório local filtrável com resultados, duração, arquivo/linha e erro.
- `results.json`: os mesmos resultados estruturados.
- `junit.xml`: falhas e casos ignorados/pendentes para consumidores JUnit.
- `lcov.info`: gerado apenas em `test:coverage`.

Uma execução pode terminar sem falhas e ainda ter cenários pendentes. **Pendentes e ignorados nunca são somados aos aprovados.** O HTML mostra essa distinção e os JUnit os classificam como skipped.

A cobertura mede apenas os dois módulos carregados diretamente pelo Node: `backend/src/modules/integrations/providers.ts` e `checkout.ts`. Não mede as rotas dentro do processo workerd, a interface, pedidos futuros ou APIs externas. Os limites iniciais são 90% de linhas, 85% de branches e 85% de funções nesse escopo. Não os reduza apenas para fazer uma mudança passar.

## Casos atuais e futuros

Os testes simulados cobrem criação por forma de pagamento e parcelas, total incluindo frete, adulteração de preço, tentativas concorrentes com a mesma chave, repetição de cobrança, erro de provedor, JSON inválido, link de fatura inválido, falta de CPF, CEP/medidas/peso, produtos múltiplos, ausência de serviços, estoque insuficiente e cotação expirada/de outro cliente/com preço alterado. Timeout é provocado realmente pelo `AbortSignal`, com prazo reduzido somente no mock do teste.

`tests/scenarios.json` preserva o inventário histórico de requisitos. Os TODOs foram substituídos por testes de implementação em `tests/integration/commerce.test.mjs`. O escopo de e-mail adotado é entrega local; um provedor externo, incluindo seus timeouts e idempotência, ainda exige configuração e implementação próprias.

Os testes exercitam as rotas e o banco reais do Worker, com os provedores externos simulados, até a entrega. A homologação no serviço real exige credenciais, remetente, embalagens e dados fiscais; não é equivalente à aprovação dos testes locais.

## Sandbox real (opcional)

Esta suíte não roda em `npm test`, em commits ou em PRs. Não foi necessário executá-la para validar a infraestrutura local.

1. Copie `.env.sandbox.example` para `.env.sandbox`.
2. Preencha **credenciais sandbox**, sem compartilhá-las no chat ou no Git. O token do Melhor Envio não permite identificar visualmente seu ambiente; confirme sua origem no painel sandbox.
3. Mantenha `RUN_SANDBOX_TESTS=1` apenas nesse arquivo e execute `npm.cmd run test:sandbox` conscientemente.
4. Opcionalmente defina `SANDBOX_PROVIDER=asaas` ou `melhorenvio` para testar apenas um.

Os hosts são fixos e há uma lista de operações permitidas: leitura de uma cobrança/listagem limitada do Asaas e uma cotação de frete fictícia no Melhor Envio. São no máximo duas requisições, sem retentativa automática. Nenhuma cobrança, etiqueta, estorno ou envio de e-mail é criado. Corpos de respostas reais e credenciais não entram nos relatórios.

O teste do Asaas exige prefixo de chave de homologação. Chaves inválidas falham, sem imprimir seu conteúdo. Sem ativação explícita, o comando termina com erro de configuração, não como teste aprovado.

## GitHub Actions

- `tests.yml`: PRs e pushes na `main`; TypeScript, testes locais, cobertura, auditoria de dependências de produção e upload de relatórios. Sem credenciais ou deploy.
- `sandbox-tests.yml`: somente `workflow_dispatch`. Usa secrets `ASAAS_SANDBOX_API_KEY` e `MELHOR_ENVIO_SANDBOX_TOKEN` no environment `sandbox-tests`. É recomendado proteger esse environment com aprovação antes da execução.

Os arquivos de workflow precisam ser commitados/enviados ao GitHub para serem executados. A criação desses arquivos não configura automaticamente regras de proteção de branch. Em **Settings → Rules → Rulesets**, configure a branch `main` para exigir o check **Required tests** antes do merge. Ative essa exigência após o primeiro workflow aparecer no GitHub. Nenhuma regra remota foi alterada automaticamente e não há workflow de deploy ou aprovação automática.

Falhas obrigatórias retornam código diferente de zero, interrompem o job e ficam nos artefatos. A lista de TODOs não homologa as funcionalidades futuras.

## O que ainda exige homologação

- Permissões e autenticação reais dos provedores, somente na suíte sandbox opt-in.
- Pagamento aprovado/recusado e estornos reais de sandbox, além das simulações automatizadas.
- Assinaturas reais, URL HTTPS acessível e associação ao aplicativo do Melhor Envio.
- Compra e ciclo de etiquetas sandbox com as credenciais e os dados fiscais do remetente.
- Configuração de domínio/e-mail transacional e verificação de recebimento no endereço de teste.
- Regras fiscais e dados reais de embalagem antes de qualquer produção.
- GitHub Actions no runner hospedado e proteção de branch, após publicação dos workflows.

Mocks não comprovam compatibilidade operacional do provedor. Uma compra real em produção continua exigindo autorização separada.

## Referências oficiais

- [Node test runner](https://nodejs.org/api/test.html)
- [Playwright CI](https://playwright.dev/docs/ci)
- [GitHub Actions para Node](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [Asaas: cobrança](https://docs.asaas.com/reference/criar-nova-cobranca)
- [Asaas: webhooks](https://docs.asaas.com/docs/sobre-os-webhooks)
- [Melhor Envio: cotações](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos)
- [Melhor Envio: webhooks](https://docs.melhorenvio.com.br/docs/webhooks)

## Expedição em homologação

Para testar uma remessa fictícia com declaração de conteúdo sem NF-e, execute
`npm.cmd run test:sandbox:shipping -- --declaracao-conteudo`. Esse modo usa somente
pedidos criados pela conta fictícia da automação em homologação. Ele prioriza
a Jadlog quando disponível e aguarda até seis minutos por confirmação da
compra e, depois, até seis minutos pela geração. Se o provedor deixar a
etiqueta em processamento, consulte o mesmo envio antes de iniciar outro teste.

Execute `npm.cmd run test:sandbox:shipping` sob demanda. Preencha
`MASCAVO_SANDBOX_NFE_KEY` em `.env.sandbox` com uma chave de NF-e de teste aceita pelo
Melhor Envio Sandbox. No mesmo arquivo, preencha `MASCAVO_SANDBOX_SENDER_JSON`
com os dados do remetente da nota em um objeto JSON de uma linha, envolvido em
aspas simples. Use os campos `name`, `phone`, `email`, `company_document`,
`state_register`, `address`, `number`, `district`, `city`, `state_abbr` e
`postal_code`. O campo `complement` é opcional. Informe telefone, CNPJ e CEP
sem pontuação e o mesmo CNPJ da NF-e.

O comando usa a sessão do Wrangler, o acesso em
`.wrangler/staging-access.json` e a chave `ASAAS_SANDBOX_API_KEY` ou a chave Sandbox
de `.dev.vars`. O Melhor Envio precisa estar autorizado e com saldo fictício para a etiqueta.

O teste usa uma variante em estoque e configura o remetente de homologação e uma
sessão temporária. Execute quando a homologação estiver sem um remetente cadastrado.
O comando cria o pedido Pix, espera o webhook do Asaas, vincula a NF-e, adiciona
o envio ao carrinho do Melhor Envio, compra e gera a etiqueta Sandbox e valida
o link de impressão retornado. Ao sair, revoga a sessão e remove os dados
temporários de expedição que criou. O pedido e a etiqueta ficam disponíveis
para auditoria no Sandbox. Se uma etapa falhar após a criação, consulte o
pedido exibido antes de rodar novamente.
