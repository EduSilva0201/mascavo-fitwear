# Minutas de privacidade e cookies — Mascavo Fitwear

Preparadas em 14/11/2026 para revisão. Documento interno; não publicado.

## Informações necessárias para finalizar

- Razão social, CNPJ, endereço e contato da responsável pelo tratamento.
- E-mail que receberá pedidos sobre dados pessoais e procedimento de atendimento.
- Prazos de retenção de cadastros, pedidos, documentos fiscais, logs e backups.
- Confirmação dos fornecedores e ambientes que serão usados em produção, incluindo localização do tratamento e eventual transferência internacional.
- Confirmação das bases legais aplicáveis à operação real e das configurações de serviços externos.

## Política de privacidade — texto-base

### Quem trata seus dados

A loja Mascavo Fitwear trata dados pessoais para disponibilizar a conta de cliente e realizar as operações da loja. A identificação jurídica da responsável e seu canal de privacidade serão incluídos nesta política antes da publicação.

### Quais dados são utilizados

O cadastro solicita nome, e-mail e senha. O perfil e a compra podem exigir CPF, telefone, destinatário e endereço. O sistema registra itens, valores, frete, situação de pagamento, identificadores de cobrança e informações de entrega e nota fiscal vinculadas ao pedido. A senha é armazenada em formato de hash; o sistema não oferece consulta à senha original.

Cookies de sessão e tokens são utilizados para autenticação e segurança. O navegador também guarda a sacola e as preferências de acessibilidade. Dados técnicos utilizados em controles de segurança e registros de operação devem ser detalhados conforme a configuração definitiva de hospedagem.

### Para que os dados são utilizados

Os dados permitem criar e acessar a conta, recuperar o acesso, preparar pedidos, processar cobranças, cotar frete, organizar entregas, relacionar documentos fiscais e atender solicitações. Dados necessários à compra poderão ser tratados para execução de contrato e procedimentos relacionados. Obrigações legais e regulatórias podem exigir a conservação de documentos. As demais finalidades e suas bases legais devem ser confirmadas para a operação efetiva antes da publicação.

### Serviços envolvidos

A integração com o Asaas encaminha dados necessários à cobrança; o pagamento é realizado no ambiente do provedor. A integração com o Melhor Envio utiliza dados necessários à cotação e à expedição. Esses fluxos estão atualmente configurados para testes, e sua existência não significa que compras reais estejam habilitadas.

O widget VLibras carrega recursos de um serviço externo e oferece tradução automática em Libras. A tradução de conteúdo depende do processamento realizado pelo serviço. Algumas imagens podem ser carregadas de um provedor externo. Essas requisições podem transmitir dados técnicos de conexão, como endereço IP. Consulte também os termos de privacidade dos respectivos fornecedores.

### Conservação e segurança

O sistema aplica controles de acesso, validação de sessões e proteção contra requisições indevidas. Os prazos de conservação, descarte e tratamento de backups serão definidos e informados antes da publicação. Apagar dados no navegador não exclui cadastros ou pedidos guardados no servidor.

### Seus direitos e contato

Nos termos da legislação aplicável, você pode solicitar confirmação de tratamento, acesso, correção e informações sobre compartilhamento, além de anonimização, bloqueio ou eliminação quando cabíveis. Também pode solicitar portabilidade conforme regulamentação, revogar consentimento quando utilizado e apresentar reclamação à ANPD. A eliminação pode estar sujeita a hipóteses legais de conservação. O atendimento poderá exigir verificação proporcional da identidade para proteger os dados.

O canal de atendimento de privacidade será incluído antes da publicação.

## Política de cookies — texto-base

### Cookies e armazenamento no navegador

Cookies são pequenos registros utilizados pelo navegador. A loja também utiliza localStorage e sessionStorage, tecnologias distintas descritas abaixo para dar transparência ao armazenamento no dispositivo.

| Registro | Finalidade | Duração configurada |
| --- | --- | --- |
| `__Host-mascavo-session` / `mascavo-session-local` | Autenticação da conta | Até 7 dias; a sessão também pode expirar por inatividade após 1 dia ou ser revogada |
| `__Host-mascavo-csrf` / `mascavo-csrf-local` | Proteção contra requisições indevidas | Até 7 dias; pode ser renovado |
| `mascavo-cart` — localStorage | Manter a sacola no dispositivo | Sem expiração automática configurada; conteúdo atualizado pelo uso da sacola |
| `mascavo:accessibility:v1` — localStorage | Guardar ajustes de acessibilidade | Sem expiração automática configurada; pode ser restaurado no painel |
| `mascavo:entry:v1` — sessionStorage | Evitar repetir a animação de entrada na mesma sessão da aba | Durante a sessão da aba |

Os nomes com sufixo `-local` são usados no ambiente HTTP de desenvolvimento. Em HTTPS, são usados os nomes com prefixo `__Host-`.

### Serviços externos

O VLibras carrega código e recursos externos. O inventário acima descreve o armazenamento implementado diretamente pela loja, e não constitui uma auditoria dos registros criados por fornecedores. O comportamento desses serviços deverá ser verificado no navegador antes da publicação. Novos recursos de publicidade ou medição devem ser avaliados antes da ativação, incluindo a necessidade de controle prévio de consentimento.

### Como gerenciar

Você pode excluir ou bloquear cookies nas configurações do navegador. Bloquear cookies de autenticação e segurança pode impedir o acesso à conta e operações que dependam dela. Para remover a sacola e preferências locais, utilize a limpeza dos dados do site no navegador; isso não apaga registros do servidor. O painel de acessibilidade permite restaurar seus ajustes.

## Fontes para revisão

- ANPD — Guia orientativo Cookies e Proteção de Dados Pessoais: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais
- LGPD, texto atualizado: https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html
- VLibras — Termos de Uso e Aviso de Privacidade: https://www.vlibras.gov.br/privacy.html
