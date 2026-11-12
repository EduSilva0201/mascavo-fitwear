-- Local catalog. Prices and inventory are provisional, not approved for sales.
CREATE TABLE catalog_categories (name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL);
CREATE TABLE catalog_products (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL REFERENCES catalog_categories(name),
 description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
 provisional INTEGER NOT NULL DEFAULT 1 CHECK(provisional IN (0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), sort_order INTEGER NOT NULL
);
CREATE TABLE catalog_variants (
 product_id INTEGER NOT NULL REFERENCES catalog_products(id), color TEXT NOT NULL, size TEXT NOT NULL,
 stock INTEGER NOT NULL CHECK(stock >= 0), image_url TEXT NOT NULL, sort_order INTEGER NOT NULL,
 PRIMARY KEY(product_id,color,size)
);
CREATE TABLE catalog_images (
 product_id INTEGER NOT NULL REFERENCES catalog_products(id), sort_order INTEGER NOT NULL,
 src TEXT NOT NULL, label TEXT NOT NULL, color TEXT,
 PRIMARY KEY(product_id,sort_order)
);
INSERT INTO catalog_categories VALUES ('Conjuntos',0);
INSERT INTO catalog_categories VALUES ('Macaquinho',1);
INSERT INTO catalog_categories VALUES ('Leggings',2);
INSERT INTO catalog_categories VALUES ('Tops',3);
INSERT INTO catalog_categories VALUES ('Shorts',4);
INSERT INTO catalog_categories VALUES ('Acessórios',5);
INSERT INTO catalog_products VALUES (14,'Conjunto Duo','Conjuntos','O Duo combina top de alças largas e decote arredondado com legging de cintura alta e cós largo. Os detalhes em creme no top e na abertura do bolso lateral contrastam com o vinho ou o preto, enquanto a assinatura Mascavo completa a frente da peça. Um conjunto de duas peças para compor looks de treino e do dia a dia.',18990,1,1,0);
INSERT INTO catalog_variants VALUES (14,'Vinho','M',5,'assets/products/duo/vinho-frente.png',0);
INSERT INTO catalog_variants VALUES (14,'Preto','M',5,'assets/products/duo/preto-frente.png',1);
INSERT INTO catalog_images VALUES (14,0,'assets/products/duo/vinho-frente.png','Frente em vinho','Vinho');
INSERT INTO catalog_images VALUES (14,1,'assets/products/duo/vinho-costas.jpeg','Costas em vinho','Vinho');
INSERT INTO catalog_images VALUES (14,2,'assets/products/duo/preto-frente.png','Frente em preto','Preto');
INSERT INTO catalog_images VALUES (14,3,'assets/products/duo/preto-costas.png','Costas em preto','Preto');
INSERT INTO catalog_images VALUES (14,4,'assets/products/duo/preto-detalhe.png','Detalhe do top em preto','Preto');
INSERT INTO catalog_products VALUES (13,'Conjunto Ibiza','Conjuntos','O Ibiza combina top alongado de decote arredondado e costas nadador com shorts de cintura alta, cós largo e modelagem solta. O bolso lateral traz praticidade à peça, enquanto o visual liso em azul petróleo facilita as combinações para o treino e o dia a dia.',18990,1,1,1);
INSERT INTO catalog_variants VALUES (13,'Azul petróleo','M',5,'assets/products/ibiza/azul-petroleo-frente.png',0);
INSERT INTO catalog_variants VALUES (13,'Azul petróleo','G',5,'assets/products/ibiza/azul-petroleo-frente.png',1);
INSERT INTO catalog_images VALUES (13,0,'assets/products/ibiza/azul-petroleo-frente.png','Frente em azul petróleo','Azul petróleo');
INSERT INTO catalog_images VALUES (13,1,'assets/products/ibiza/azul-petroleo-costas.png','Costas em azul petróleo','Azul petróleo');
INSERT INTO catalog_products VALUES (12,'Conjunto Fusion','Conjuntos','O Fusion combina blusa sem mangas de decote arredondado com shorts de cintura alta e modelagem solta. O recorte amplo nas costas e as faixas cruzadas destacam o desenho da parte superior, enquanto o cós largo com assinatura Mascavo completa o visual. Disponível em preto e rosa bebê para compor looks de treino e do dia a dia.',19990,1,1,2);
INSERT INTO catalog_variants VALUES (12,'Preto','M',5,'assets/products/fusion/preto-frente.png',0);
INSERT INTO catalog_variants VALUES (12,'Preto','G',5,'assets/products/fusion/preto-frente.png',1);
INSERT INTO catalog_variants VALUES (12,'Rosa bebê','M',5,'assets/products/fusion/rosa-bebe-frente.png',2);
INSERT INTO catalog_variants VALUES (12,'Rosa bebê','G',5,'assets/products/fusion/rosa-bebe-frente.png',3);
INSERT INTO catalog_images VALUES (12,0,'assets/products/fusion/preto-frente.png','Frente em preto','Preto');
INSERT INTO catalog_images VALUES (12,1,'assets/products/fusion/preto-costas.jpeg','Costas em preto','Preto');
INSERT INTO catalog_images VALUES (12,2,'assets/products/fusion/rosa-bebe-frente.png','Frente em rosa bebê','Rosa bebê');
INSERT INTO catalog_images VALUES (12,3,'assets/products/fusion/rosa-bebe-costas.png','Costas em rosa bebê','Rosa bebê');
INSERT INTO catalog_products VALUES (11,'Conjunto Race','Conjuntos','O Race combina top de decote reto e alças largas com shorts de cintura alta e cós largo. Nas costas, o recorte aberto e as faixas cruzadas dão destaque ao desenho do top. A assinatura Mascavo na frente completa o conjunto, disponível em preto e azul petróleo para compor seu look de treino e do dia a dia.',18990,1,1,3);
INSERT INTO catalog_variants VALUES (11,'Preto','M',5,'assets/products/race/preto-frente.png',0);
INSERT INTO catalog_variants VALUES (11,'Preto','G',5,'assets/products/race/preto-frente.png',1);
INSERT INTO catalog_variants VALUES (11,'Azul petróleo','M',5,'assets/products/race/azul-petroleo-frente.png',2);
INSERT INTO catalog_variants VALUES (11,'Azul petróleo','G',5,'assets/products/race/azul-petroleo-frente.png',3);
INSERT INTO catalog_images VALUES (11,0,'assets/products/race/preto-frente.png','Frente em preto','Preto');
INSERT INTO catalog_images VALUES (11,1,'assets/products/race/azul-petroleo-frente.png','Frente em azul petróleo','Azul petróleo');
INSERT INTO catalog_images VALUES (11,2,'assets/products/race/azul-petroleo-costas.jpeg','Costas em azul petróleo','Azul petróleo');
INSERT INTO catalog_products VALUES (10,'Macaquinho Fluid','Macaquinho','O Fluid combina alças finas ajustáveis, decote arredondado e corpo de visual liso com shorts em sobreposição. O bolso lateral na camada interna traz praticidade, enquanto a cor chocolate e a assinatura Mascavo completam a peça com um visual versátil para o treino e o dia a dia.',17990,1,1,4);
INSERT INTO catalog_variants VALUES (10,'Chocolate','M',5,'assets/products/fluid/frente.png',0);
INSERT INTO catalog_variants VALUES (10,'Chocolate','G',5,'assets/products/fluid/frente.png',1);
INSERT INTO catalog_images VALUES (10,0,'assets/products/fluid/frente.png','Frente',NULL);
INSERT INTO catalog_images VALUES (10,1,'assets/products/fluid/costas.jpeg','Costas',NULL);
INSERT INTO catalog_images VALUES (10,2,'assets/products/fluid/detalhe.jpeg','Detalhe do bolso',NULL);
INSERT INTO catalog_products VALUES (9,'Conjunto Sofi','Conjuntos','O Sofi combina top de decote arredondado e alças largas com legging de cintura alta e cós largo. O visual liso, com assinatura Mascavo no top, traz uma proposta versátil para compor looks de treino e do dia a dia.',19990,1,1,5);
INSERT INTO catalog_variants VALUES (9,'Preto','M',5,'assets/products/sofi/preto.png',0);
INSERT INTO catalog_variants VALUES (9,'Preto','G',5,'assets/products/sofi/preto.png',1);
INSERT INTO catalog_variants VALUES (9,'Vinho','M',5,'assets/products/sofi/vinho.png',2);
INSERT INTO catalog_variants VALUES (9,'Vinho','G',5,'assets/products/sofi/vinho.png',3);
