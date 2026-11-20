# Mascavo Studio — painel administrativo

O painel usa os mesmos tons, cartões arredondados e botões do login e da sacola. Acesse **http://127.0.0.1:8787/admin** com o servidor local em execução.

## Primeiro acesso

1. Cadastre a conta que será usada pela administradora na loja.
2. Confirme o e-mail pelo fluxo local de confirmação. Neste ambiente, `npm.cmd run mail:local` permite consultar a caixa de testes.
3. No terminal do projeto, conceda a permissão à conta confirmada:

   ```powershell
   npm.cmd run admin:grant -- email-da-administradora@exemplo.com
   ```

4. Entre no painel com o mesmo e-mail e senha da conta. Confira na saída do comando se o usuário foi encontrado e aparece com `role` igual a `admin`.

Não há senha padrão, cadastro público de administrador ou elevação de privilégio pela interface. Para remover acesso:

```powershell
npm.cmd run admin:grant -- email-da-administradora@exemplo.com --revoke
```

O comando atua somente no banco local e em contas ativas com e-mail confirmado. Não cria usuários nem altera senhas. A API revalida a permissão em cada requisição, incluindo para sessões já abertas.

## Como usar

- **Depoimentos:** cadastrar nome, identificação opcional, relato, foto opcional e avaliação opcional. Novos itens começam como rascunho. Marque publicação e salve para exibir na seção **Quem veste, conta.** da página inicial. A posição organiza a ordem. Desmarque publicação para retirar do site sem apagar o registro. Sem foto, o cartão usa iniciais. O comando local `npm.cmd run content:demo` cadastra três exemplos identificados como fictícios, com retratos ilustrados. É seguro repeti-lo: registros existentes não são sobrescritos. Os três SVG fornecidos em `assets/testimonials` são permitidos como imagens estáticas; o upload de SVG continua bloqueado.
- **Dúvidas frequentes:** cadastrar pergunta, resposta, assunto, posição e publicação. Os itens publicados aparecem em `/duvidas-frequentes`, com busca por texto e filtros por assunto. A página já possui três respostas sobre o funcionamento atual da loja em testes. Políticas comerciais devem ser cadastradas pela administração quando estiverem definidas.

- **Visão geral:** produtos publicados, peças disponíveis, variantes com estoque baixo e categorias. Os números refletem o banco; não representam vendas ou receita.
- **Produtos:** buscar e filtrar; cadastrar e editar nome, categoria, descrição, preço, posição na vitrine e aviso de preço provisório. Novos produtos começam em rascunho. Marque **Publicado na vitrine** para exibi-los. Desmarque para retirar de venda sem apagar o cadastro.
- **Estoque:** filtrar por produto/cor/tamanho e ver esgotados ou variantes com uma unidade. Em **Ajustar**, edite as quantidades e o tom visual de cada cor. **Uma peça por variante** e **Zerar variantes** modificam apenas o formulário do produto aberto; confirme em **Salvar produto**.
- **Imagens:** upload de PNG/JPG/WebP de até 5 MB no R2 local. O editor permite enviar diretamente, trocar caminhos, legendas e associação por cor. A primeira imagem da galeria é a capa. A imagem na variante representa a cor selecionada. Remover da galeria não apaga o arquivo da biblioteca.
- **Categorias:** criar, renomear e remover categorias vazias. Renomear atualiza os produtos associados. Filtros da coleção usam as categorias do banco. Cards editoriais e links fixos da página inicial ainda são parte do layout; ao renomear categorias usadas nesses cards, revise esses links no código.
- **Minha loja:** nome, assinatura, aviso, contatos, títulos/textos/imagens das duas campanhas e CEP/peso/medidas usados nas cotações. Campos opcionais vazios preservam o padrão do site ou do `.dev.vars`. Campos de campanha preenchidos substituem seus valores na página inicial. O texto do título é simples, sem a marcação de itálico do padrão. O nome muda título do navegador e rodapé, não o arquivo da logomarca.
- **Atividades:** últimas alterações de produtos, categorias e configurações, com conta e horário. Não registra senhas, dados de cartão ou tokens.

As mudanças salvas entram na API imediatamente. Atualize a vitrine para vê-las. Edite fotos com boa qualidade e formato adequado; o upload não faz recorte ou otimização automática. O painel aceita caminhos locais `assets/...` e `/media/...`, não URLs externas nem SVG enviados pelo usuário.

## Proteções e limites

- Sessão autenticada, usuário ativo, e-mail confirmado e papel `admin` são obrigatórios em todas as APIs administrativas.
- Escritas exigem origem local válida e token CSRF. Clientes não podem conceder a si mesmos acesso administrativo.
- Produtos e configurações usam revisão para impedir que uma aba sobrescreva silenciosamente outra. Ao receber conflito, recarregue o painel antes de editar novamente.
- Preços são persistidos em centavos; estoque é inteiro e não pode ser negativo. Variantes repetidas são rejeitadas.
- Os textos do catálogo são simples e rejeitam HTML, aspas e `&`, pois a vitrine atual ainda usa templates HTML.
- Novas imagens têm nome aleatório, formato verificado e leitura pública apenas por `/media/`. Segredos continuam em `.dev.vars`, excluído do Git e dos arquivos publicados.
- O estoque de demonstração existente foi preservado. Configure uma unidade por variante pelo painel quando quiser aplicar o estoque inicial.
- Estoque editável não substitui a reserva transacional de compras: pedidos, reservas, baixa automática, etiquetas, estornos e gestão de clientes ainda não fazem parte deste painel.
- A aplicação permanece restrita a localhost/sandbox. Publicação exige separar ambientes, configurar e-mail real, MFA para administração, backups e limites de acesso; este painel não habilita produção.

## Verificação

`npm.cmd run check` verifica TypeScript, autenticação, catálogo, checkout e painel. O teste administrativo usa banco e armazenamento isolados: acesso negado para cliente comum; cadastro/edição de produto; estoque público; conflito de revisão; categorias; configurações; upload e leitura; descarte de formulário; revogação de acesso e layout mobile.

Após atualizar:

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

A migração `0008_admin.sql` adiciona configurações, mídia, auditoria e revisão dos produtos, sem trocar fotos, preços ou quantidades existentes.

A migração `0009_variant_colors.sql` permite configurar o tom exibido nos seletores de cor. As cores existentes preservam o padrão até serem editadas.

A migração `0010_editorial_content.sql` adiciona as tabelas de depoimentos e FAQ. Edições exigem acesso administrativo e CSRF, têm revisão contra sobrescrita entre abas e entram no histórico de atividades. A API pública `/api/v1/content` retorna somente itens publicados. A animação de depoimentos pode ser pausada, para ao passar o mouse e é desativada em telas pequenas ou com preferência por movimento reduzido. As cópias visuais do carrossel ficam ocultas para tecnologias assistivas.
