CREATE TABLE editorial_testimonials (
 id TEXT PRIMARY KEY,
 author_name TEXT NOT NULL, author_detail TEXT NOT NULL DEFAULT '',
 quote TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '',
 rating INTEGER CHECK(rating BETWEEN 1 AND 5),
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 revision TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE editorial_faq (
 id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'Geral',
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 revision TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX editorial_testimonials_published ON editorial_testimonials(published,sort_order);
CREATE INDEX editorial_faq_published ON editorial_faq(published,sort_order);
-- No invented customer testimonials are published or seeded.
INSERT INTO editorial_faq VALUES ('00000000-0000-4000-8000-000000000001','Como escolho a cor e o tamanho?','Abra os detalhes da peça para escolher a cor e o tamanho antes de adicionar à sacola. As opções disponíveis aparecem em cada produto.','Produtos',1,0,'initial',0);
INSERT INTO editorial_faq VALUES ('00000000-0000-4000-8000-000000000002','Como consulto o frete?','Na sacola, informe seu CEP na área de entrega e pagamento. Entre na sua conta para consultar os serviços disponíveis. A loja está em testes: os valores de sandbox são simulações.','Entrega',1,1,'initial',0);
INSERT INTO editorial_faq VALUES ('00000000-0000-4000-8000-000000000003','Já posso fazer uma compra real?','A Mascavo está em preparação. As cobranças atuais são de teste e não criam pedidos reais. Acompanhe nossos canais para saber quando as vendas estiverem disponíveis.','Compras',1,2,'initial',0);
