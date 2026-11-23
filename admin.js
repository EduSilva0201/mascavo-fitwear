(() => {
  'use strict';
  const $ = (s) => document.querySelector(s),
    esc = (v) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  const money = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  let csrf = '',
    products = [],
    categories = [],
    page = 'overview',
    editId = null,
    dirty = false,
    saving = false,
    notifyTimer,
    busyLogin = false,
    unmountSales,
    integratedShipping = false,
    production = false;
  const deliveryLabels = { to_arrange: 'A combinar', scheduled: 'Agendada', delivered: 'Entregue' };
  const defaultOrderMessage = 'Olá, {nome}! Aqui é a Mascavo Fitwear. Podemos combinar a entrega do seu pedido {pedido} por aqui?';
  const editor = $('#editor'),
    fields = $('#editor-fields');
  function notify(text, error = false) {
    const n = $('#notification');
    n.textContent = text;
    n.dataset.error = String(error);
    n.hidden = false;
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => (n.hidden = true), 6000);
  }
  async function token() {
    const r = await fetch('/api/v1/auth/csrf');
    if (!r.ok) throw Error('Inicie o servidor local para acessar o painel.');
    csrf = (await r.json()).csrfToken;
  }
  async function api(path, data, raw = false) {
    if (data !== undefined && !csrf) await token();
    const r = await fetch('/api/v1/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers:
        data === undefined
          ? {}
          : { 'Content-Type': raw ? data.type : 'application/json', 'X-CSRF-Token': csrf },
      body: data === undefined ? undefined : raw ? data : JSON.stringify(data),
    });
    const result = await r.json();
    if (result.csrfToken) csrf = result.csrfToken;
    if (!r.ok) {
      if (r.status === 403) csrf = '';
      if (r.status === 401 && !path.startsWith('auth/')) {
        $('#admin-shell').hidden = true;
        $('#admin-login').hidden = false;
      }
      throw Error(result.error || 'Não foi possível concluir a operação.');
    }
    return result;
  }
  async function load() {
    const data = await api('admin/catalog');
    products = data.products;
    categories = data.categories;
  }
  function heading(title, subtitle, action = '') {
    return `<div class="page-heading"><div><span class="eyebrow">MASCAVO / STUDIO</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
  }
  function count(p) {
    return p.variants.reduce((n, v) => n + v.stock, 0);
  }
  function badge(p) {
    return `<span class="badge ${!p.active ? 'off' : !count(p) ? 'zero' : ''}">${!p.active ? 'Rascunho' : !count(p) ? 'Sem estoque' : 'Publicado'}</span>`;
  }
  async function navigate(target) {
    unmountSales?.();
    unmountSales = undefined;
    page = target;
    document.querySelectorAll('[data-page]').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === page);
      b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false');
    });
    $('#breadcrumb').textContent = {
      overview: 'Visão geral',
      products: 'Produtos',
      inventory: 'Estoque',
      media: 'Imagens',
      categories: 'Categorias',
      testimonials: 'Depoimentos',
      faq: 'Dúvidas frequentes',
      settings: 'Minha loja',
      audit: 'Atividades',
      sales: 'Relatório de vendas',
      orders: 'Pedidos e entregas',
      fulfillment: 'Remetente e pacotes',
      'order-mail': production ? 'E-mails de pedidos' : 'E-mails de teste',
    }[page];
    try {
      if (page === 'overview') overview();
      if (page === 'products') productPage();
      if (page === 'inventory') inventory();
      if (page === 'media') await mediaPage();
      if (page === 'categories') categoryPage();
      if (page === 'settings') await settingsPage();
      if (page === 'audit') await auditPage();
      if (page === 'sales') await salesPage();
      if (page === 'orders') await ordersPage();
      if (page === 'fulfillment') await fulfillmentPage();
      if (page === 'order-mail') await orderMailPage();
      if (page === 'testimonials' || page === 'faq') await contentPage(page);
    } catch (e) {
      $('#main').innerHTML =
        '<div class="empty"><h2>Não foi possível carregar.</h2><p></p><button class="secondary" id="retry-page">Tentar novamente</button></div>';
      $('#main .empty p').textContent = e.message;
      $('#retry-page').onclick = () => navigate(target);
      notify(e.message, true);
    }
  }
  async function salesPage() {
    const host = document.createElement('div');
    host.textContent = 'Carregando relatório…';
    $('#main').replaceChildren(host);
    const { mountSalesDashboard } = await import('/assets/rail-ui/admin-sales.js');
    if (page === 'sales' && host.isConnected) {
      unmountSales = mountSalesDashboard(host, days => api('orders/sales-report?days=' + days));
    }
  }
  function overview() {
    const variants = products.flatMap((p) => p.variants),
      units = variants.reduce((n, v) => n + v.stock, 0),
      low = variants.filter((v) => v.stock <= 1).length;
    $('#main').innerHTML =
      heading(
        'Tudo começa por aqui.',
        'Uma visão tranquila de cada detalhe da sua coleção.',
        '<button class="primary" data-new>Novo produto</button>',
      ) +
      `<div class="stats"><article class="stat"><small>Produtos na coleção</small><strong>${products.length}</strong><p>${products.filter((p) => p.active).length} publicados na vitrine</p></article><article class="stat"><small>Peças disponíveis</small><strong>${units}</strong><p>Somatório de todas as variantes</p></article><article class="stat"><small>Estoque baixo</small><strong>${low}</strong><p>Variantes com uma peça ou esgotadas</p></article><article class="stat"><small>Categorias</small><strong>${categories.length}</strong><p>Para organizar suas escolhas</p></article></div>` +
      '<div class="split"><article class="welcome-card"><span class="eyebrow">CUIDADO EM CADA ESCOLHA</span><h2>Uma coleção com a sua assinatura.</h2><p>Adicione peças, escolha as melhores imagens e acompanhe cada cor e tamanho em um só lugar.</p><button class="secondary" data-page="products">Cuidar da coleção</button></article><article class="card"><span class="eyebrow">ANTES DE PUBLICAR</span><h2>Os detalhes importam.</h2><p class="hint">Confira fotos, preço, descrição e estoque de cada variante. Produtos em rascunho ficam fora da vitrine.</p><button class="secondary" data-page="inventory">Revisar estoque</button></article></div>' +
      '<div class="card"><h2>Precisam de atenção</h2><div class="category-list">' +
      products
        .filter((p) => !p.active || p.variants.some((v) => v.stock <= 1))
        .slice(0, 5)
        .map(
          (p) =>
            `<div class="category-row"><div>${esc(p.name)}<span> · ${count(p)} peça(s)</span></div><button class="secondary" data-edit="${p.id}">Revisar</button></div>`,
        )
        .join('') +
      '</div><p class="hint">' + (production ? 'Acompanhe os pagamentos no menu Pedidos e entregas.'
        : 'Os pagamentos são de teste no Asaas Sandbox. Acompanhe os pedidos no menu Pedidos e entregas.') + '</p></div>';
  }
  function productPage() {
    $('#main').innerHTML =
      heading(
        'Sua coleção.',
        'Peças, imagens e detalhes que dão vida à vitrine.',
        '<button class="primary" data-new>Novo produto</button>',
      ) +
      '<div class="toolbar"><input id="product-search" aria-label="Buscar produto" placeholder="Buscar pelo nome da peça…"><select id="category-filter" aria-label="Filtrar categoria"><option value="">Todas as categorias</option>' +
      categories.map((c) => `<option>${esc(c.name)}</option>`).join('') +
      '</select><select id="status-filter" aria-label="Filtrar status"><option value="">Todos os status</option><option value="1">Publicados</option><option value="0">Rascunhos</option></select><span class="count" id="result-count"></span></div><div class="product-grid" id="product-grid"></div>';
    $('#product-search').oninput = drawProducts;
    $('#category-filter').onchange = drawProducts;
    $('#status-filter').onchange = drawProducts;
    drawProducts();
  }
  function drawProducts() {
    const q = $('#product-search').value.toLocaleLowerCase(),
      cat = $('#category-filter').value,
      status = $('#status-filter').value;
    const rows = products.filter(
      (p) =>
        p.name.toLocaleLowerCase().includes(q) &&
        (!cat || p.category === cat) &&
        (status === '' || String(p.active) === status),
    );
    $('#result-count').textContent = rows.length + ' produto(s)';
    $('#product-grid').innerHTML = rows.length
      ? rows
          .map(
            (p) =>
              `<article class="product-card"><div class="product-cover"><img src="${esc(p.images[0]?.src || p.variants[0]?.image_url || '')}" alt="${esc(p.name)}" loading="lazy">${badge(p)}</div><div class="product-copy"><span class="eyebrow">${esc(p.category)}</span><h3>${esc(p.name)}</h3><div class="meta"><strong>${money(p.price_cents)}</strong><span>${count(p)} peça(s) · ${p.variants.length} variantes</span></div><button class="secondary" data-edit="${p.id}">Editar produto</button></div></article>`,
          )
          .join('')
      : '<div class="empty"><h2>Nenhuma peça encontrada.</h2><p>Experimente outro filtro ou adicione seu primeiro produto.</p></div>';
  }
  function inventory() {
    const rows = products.flatMap((p) => p.variants.map((v) => ({ p, v })));
    $('#main').innerHTML =
      heading('Cada peça conta.', 'Controle independente por produto, cor e tamanho.') +
      '<div class="card"><p class="hint">Para começar com uma peça por variante, abra o produto e use “Uma peça por variante”, depois salve. O estoque atual não é alterado automaticamente.</p></div><div class="toolbar"><input id="stock-search" aria-label="Buscar no estoque" placeholder="Buscar produto, cor ou tamanho…"><select id="stock-filter" aria-label="Filtrar estoque"><option value="all">Todo o estoque</option><option value="low">Uma peça ou menos</option><option value="zero">Esgotados</option></select></div><div class="table-wrap"><table><thead><tr><th>Produto / variante</th><th>Estoque</th><th>Status</th><th>Ação</th></tr></thead><tbody id="stock-rows"></tbody></table></div>';
    function draw() {
      const q = $('#stock-search').value.toLocaleLowerCase(),
        f = $('#stock-filter').value;
      $('#stock-rows').innerHTML = rows
        .filter(
          ({ p, v }) =>
            (p.name + ' ' + v.color + ' ' + v.size).toLocaleLowerCase().includes(q) &&
            (f === 'all' || (f === 'low' && v.stock <= 1) || (f === 'zero' && v.stock === 0)),
        )
        .map(
          ({ p, v }) =>
            `<tr><td>${esc(p.name)}<small>${esc(v.color)} / ${esc(v.size)}</small></td><td><strong>${v.stock}</strong></td><td><span class="badge ${v.stock === 0 ? 'zero' : v.stock === 1 ? 'off' : ''}">${v.stock === 0 ? 'Esgotado' : v.stock === 1 ? 'Última peça' : 'Disponível'}</span></td><td><button class="secondary" data-edit="${p.id}">Ajustar</button></td></tr>`,
        )
        .join('');
    }
    $('#stock-search').oninput = draw;
    $('#stock-filter').onchange = draw;
    draw();
  }
  function variantRow(v = { color: '', size: 'M', stock: 1, image_url: '' }) {
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML = `<label>Cor<input data-v="color" value="${esc(v.color)}" required maxlength="60"></label><label>Tamanho<input data-v="size" value="${esc(v.size)}" required maxlength="20"></label><label>Estoque<input data-v="stock" type="number" min="0" max="100000" value="${v.stock}" required></label><label>Imagem da cor<input data-v="image_url" value="${esc(v.image_url)}" required placeholder="/media/… ou assets/…"></label><button type="button" class="row-remove" aria-label="Remover variante">×</button>`;
    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.dataset.v = 'color_hex';
    const defaults = {
      Preto: '#1c1c1c',
      Vinho: '#6e1737',
      Chocolate: '#40210f',
      Areia: '#f2d7b6',
      Cacau: '#73462d',
      Caramelo: '#bf8b5e',
    };
    swatch.value = v.color_hex || defaults[v.color] || '#b59b83';
    swatch.setAttribute('aria-label', 'Tom da cor');
    row.querySelector('label').append(swatch);
    row.querySelector('.row-remove').onclick = () => {
      row.remove();
      dirty = true;
    };
    return row;
  }
  function imageRow(im = { src: '', label: '', color: null }) {
    const row = document.createElement('div');
    row.className = 'image-row';
    row.innerHTML = `<img ${im.src ? 'src="' + esc(im.src) + '"' : ''} alt="Prévia"><label>Imagem<input data-i="src" value="${esc(im.src)}" required placeholder="/media/… ou assets/…"></label><label>Legenda<input data-i="label" value="${esc(im.label)}" required maxlength="100"></label><label>Cor (opcional)<input data-i="color" value="${esc(im.color || '')}" maxlength="60"></label><button type="button" class="row-remove" aria-label="Remover foto">×</button>`;
    row.querySelector('[data-i="src"]').onchange = (e) => {
      if (/^(assets\/|\/media\/)/.test(e.target.value))
        row.querySelector('img').src = e.target.value;
    };
    row.querySelector('.row-remove').onclick = () => {
      row.remove();
      dirty = true;
    };
    return row;
  }
  function openEditor(id) {
    const p = products.find((p) => p.id === id);
    editId = p?.id ?? null;
    dirty = false;
    $('#editor-title').textContent = p ? 'Editar ' + p.name : 'Uma nova peça.';
    $('#editor-feedback').textContent = '';
    fields.innerHTML = `<section class="editor-section"><h3>01 / Informações da peça</h3><div class="form-grid"><label>Nome<input name="name" value="${esc(p?.name || '')}" maxlength="100" required></label><label>Categoria<select name="category" required>${categories.map((c) => `<option ${p?.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="full">Descrição<textarea name="description" required maxlength="2000">${esc(p?.description || '')}</textarea></label><label>Preço (R$)<input name="price" type="number" min="0.01" max="100000" step="0.01" required value="${p ? (p.price_cents / 100).toFixed(2) : ''}"></label><label>Ordem na vitrine<input name="sort_order" type="number" min="0" max="10000" value="${p?.sort_order ?? products.length}"></label><label class="check"><input type="checkbox" name="active" ${p?.active ? 'checked' : ''}>Publicado na vitrine</label><label class="check"><input type="checkbox" name="provisional" ${p?.provisional ? 'checked' : ''}>Exibir aviso de preço provisório</label></div><p class="hint">Use texto simples, sem HTML, aspas ou &. Produtos novos começam como rascunho.</p></section><section class="editor-section"><h3>02 / Cores, tamanhos e estoque</h3><p class="hint">Cada linha é uma variante. Informe o caminho da imagem que representa a cor.</p><div id="variant-rows"></div><div class="actions"><button type="button" class="secondary" id="add-variant">+ Adicionar variante</button><button type="button" class="secondary" id="stock-one">Uma peça por variante</button><button type="button" class="secondary" id="stock-zero">Zerar variantes</button></div></section><section class="editor-section"><h3>03 / Imagens da galeria</h3><p class="hint">A primeira foto é a capa. Envie fotos do computador ou cole caminhos da biblioteca. PNG, JPG ou WebP, até 5 MB.</p><div id="image-rows"></div><div class="actions"><button type="button" class="secondary" id="add-image">+ Adicionar foto</button><label class="secondary">Enviar imagem<input id="editor-upload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label></div></section>`;
    (p?.variants || [undefined]).forEach((v) => $('#variant-rows').append(variantRow(v)));
    (p?.images || [undefined]).forEach((i) => $('#image-rows').append(imageRow(i)));
    $('#add-variant').onclick = () => {
      $('#variant-rows').append(variantRow());
      dirty = true;
    };
    $('#add-image').onclick = () => {
      $('#image-rows').append(imageRow());
      dirty = true;
    };
    $('#stock-one').onclick = () => {
      fields.querySelectorAll('[data-v="stock"]').forEach((el) => (el.value = 1));
      dirty = true;
    };
    $('#stock-zero').onclick = () => {
      fields.querySelectorAll('[data-v="stock"]').forEach((el) => (el.value = 0));
      dirty = true;
    };
    $('#editor-upload').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const src = await upload(file);
        const empty = [...fields.querySelectorAll('.image-row')].find(
          (r) => !r.querySelector('[data-i="src"]').value,
        );
        if (empty) empty.remove();
        $('#image-rows').append(imageRow({ src, label: 'Foto do produto', color: null }));
        fields.querySelectorAll('[data-v="image_url"]').forEach((el) => {
          if (!el.value) el.value = src;
        });
        dirty = true;
        notify('Imagem enviada. Salve o produto para aplicar.');
      } catch (err) {
        $('#editor-feedback').textContent = err.message;
      } finally {
        e.target.value = '';
      }
    };
    if (!editor.open) editor.showModal();
  }
  async function upload(file) {
    if (file.size > 5 * 1024 * 1024) throw Error('A imagem deve ter no máximo 5 MB.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw Error('Escolha PNG, JPG ou WebP.');
    return (await api('admin/media', file, true)).src;
  }
  function requestClose() {
    if (saving) return;
    if (dirty) $('#confirm-dialog').showModal();
    else editor.close();
  }
  editor.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  editor.querySelectorAll('[data-close]').forEach((b) => (b.onclick = requestClose));
  $('#keep-editing').onclick = () => $('#confirm-dialog').close();
  $('#discard-editing').onclick = () => {
    $('#confirm-dialog').close();
    editor.close();
    dirty = false;
  };
  $('#product-form').oninput = () => (dirty = true);
  $('#product-form').onsubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    saving = true;
    editor.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const f = new FormData(e.target),
      current = products.find((p) => p.id === editId);
    const body = {
      name: f.get('name'),
      category: f.get('category'),
      description: f.get('description'),
      price_cents: Math.round(Number(f.get('price')) * 100),
      sort_order: Number(f.get('sort_order')),
      active: f.has('active'),
      provisional: f.has('provisional'),
      ...(current ? { revision: current.revision } : {}),
      variants: [...fields.querySelectorAll('.variant-row')].map((row) =>
        Object.fromEntries(
          [...row.querySelectorAll('[data-v]')].map((el) => [
            el.dataset.v,
            el.dataset.v === 'stock' ? Number(el.value) : el.value,
          ]),
        ),
      ),
      images: [...fields.querySelectorAll('.image-row')].map((row) =>
        Object.fromEntries(
          [...row.querySelectorAll('[data-i]')].map((el) => [
            el.dataset.i,
            el.dataset.i === 'color' ? el.value || null : el.value,
          ]),
        ),
      ),
    };
    try {
      await api('admin/products/' + (editId ?? 'new'), body);
      dirty = false;
      editor.close();
      await load();
      await navigate(page);
      notify('Produto salvo. A vitrine já usa os novos dados.');
    } catch (err) {
      $('#editor-feedback').textContent = err.message;
    } finally {
      saving = false;
      editor.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  };
  async function mediaPage() {
    const { media } = await api('admin/media');
    const existing = [
      ...new Set(
        products.flatMap((p) => [
          ...p.images.map((i) => i.src),
          ...p.variants.map((v) => v.image_url),
        ]),
      ),
    ]
      .filter((src) => !src.startsWith('/media/'))
      .map((src) => ({ src }));
    const all = [...media.map((m) => ({ src: '/media/' + m.key, size: m.size })), ...existing];
    $('#main').innerHTML =
      heading(
        'Imagens que contam histórias.',
        'Sua biblioteca de fotos para compor cada produto.',
        '<label class="primary">Enviar imagem<input id="library-upload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>',
      ) +
      '<p class="hint">Copie o caminho para usar nas variantes ou na galeria de um produto. Remover uma foto da galeria não apaga o arquivo da biblioteca.</p><div class="media-grid">' +
      all
        .map(
          (m) =>
            `<article class="media-card"><img src="${esc(m.src)}" loading="lazy" alt="Imagem da biblioteca"><div><code>${esc(m.src)}</code><button class="secondary" data-copy="${esc(m.src)}">Copiar caminho</button></div></article>`,
        )
        .join('') +
      '</div>';
    $('#library-upload').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await upload(file);
        await mediaPage();
        notify('Imagem adicionada à biblioteca.');
      } catch (err) {
        notify(err.message, true);
      }
    };
  }
  function categoryPage() {
    $('#main').innerHTML =
      heading('Tudo no seu lugar.', 'Organize as peças em categorias que facilitem a escolha.') +
      '<form id="category-form" class="card"><div class="toolbar"><input name="name" required maxlength="80" placeholder="Nome da nova categoria" aria-label="Nome da categoria"><button class="primary">Adicionar categoria</button></div></form><div class="category-list">' +
      categories
        .map(
          (c) =>
            `<article class="category-row"><strong>${esc(c.name)}</strong><span>${products.filter((p) => p.category === c.name).length} produto(s)</span><button class="secondary" data-category="${esc(c.name)}">Editar</button></article>`,
        )
        .join('') +
      '</div>';
    $('#category-form').onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector('button');
      b.disabled = true;
      try {
        const result = await api('admin/categories', { name: new FormData(e.target).get('name') });
        await load();
        categoryPage();
        notify(result.message);
      } catch (err) {
        notify(err.message, true);
        b.disabled = false;
      }
    };
  }
  async function settingsPage() {
    const row = await api('admin/settings'),
      s = JSON.parse(row.data);
    $('#main').innerHTML =
      heading(
        'A essência da sua loja.',
        'Informações públicas que conectam a Mascavo às suas clientes.',
      ) +
      '<form id="settings-form" class="settings-form"><section class="card"><h2>Identidade e contato</h2><div class="form-grid">' +
      [
        ['storeName', 'Nome da loja', s.storeName || 'Mascavo Fitwear'],
        ['tagline', 'Assinatura da marca', s.tagline || 'Seu próximo movimento começa aqui.'],
        ['contactEmail', 'E-mail de contato', s.contactEmail || ''],
        ['whatsapp', 'WhatsApp (DDD + número, só dígitos)', s.whatsapp || ''],
        ['instagram', 'Instagram (sem @)', s.instagram || ''],
        ['announcement', 'Aviso da loja (opcional)', s.announcement || ''],
        ['heroTitle1', 'Campanha 1: título', s.heroTitle1 || ''],
        ['heroText1', 'Campanha 1: descrição', s.heroText1 || ''],
        ['heroImage1', 'Campanha 1: caminho da imagem', s.heroImage1 || ''],
        ['heroTitle2', 'Campanha 2: título', s.heroTitle2 || ''],
        ['heroText2', 'Campanha 2: descrição', s.heroText2 || ''],
        ['heroImage2', 'Campanha 2: caminho da imagem', s.heroImage2 || ''],
        ...(integratedShipping ? [
        ['shippingOriginCep', 'Frete: CEP de origem', s.shippingOriginCep || ''],
        ['shippingWeightKg', 'Frete: peso por item (kg)', s.shippingWeightKg || ''],
        ['shippingWidthCm', 'Frete: largura (cm)', s.shippingWidthCm || ''],
        ['shippingHeightCm', 'Frete: altura (cm)', s.shippingHeightCm || ''],
        ['shippingLengthCm', 'Frete: comprimento (cm)', s.shippingLengthCm || ''],
        ] : []),
      ]
        .map(
          ([key, label, value]) =>
            `<label>${label}<input name="${key}" value="${esc(value)}" ${['storeName', 'tagline'].includes(key) ? 'required' : ''} ${key === 'contactEmail' ? 'type="email"' : ''} maxlength="${key === 'announcement' ? 180 : key === 'tagline' ? 150 : 254}"></label>`,
        )
        .join('') +
      '</div><p class="hint">O nome atualiza o título e o rodapé. O aviso aparece acima da campanha; os contatos são adicionados ao rodapé. As chaves de API permanecem fora do painel, no arquivo local de segredos.</p></section>' +
      `<section class="card"><h2>Entrega pela loja</h2><label>Política de entrega<textarea name="deliveryPolicy" maxlength="500" rows="4">${esc(s.deliveryPolicy || '')}</textarea></label>
      <p class="hint">Informe as regiões atendidas, prazos, opções de retirada e como combinar eventual taxa. A loja exibe esse texto antes do pagamento.</p>
      <label>Mensagem padrão para WhatsApp do cliente<textarea name="orderWhatsAppMessage" maxlength="500" rows="4">${esc(s.orderWhatsAppMessage || defaultOrderMessage)}</textarea></label>
      <p class="hint">Use {nome} para o nome do cliente e {pedido} para o número do pedido. A mensagem abre no WhatsApp para você revisar e enviar.</p></section>
      <button class="primary">Salvar configurações</button></form>`;
    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector('button');
      b.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(e.target));
        for (const key of Object.keys(data))
          if ((key.startsWith('hero') || key.startsWith('shipping')) && !data[key])
            delete data[key];
        for (const key of [
          'shippingWeightKg',
          'shippingWidthCm',
          'shippingHeightCm',
          'shippingLengthCm',
        ])
          if (key in data) data[key] = Number(data[key]);
        if (!integratedShipping) {
          for (const [key, value] of Object.entries(s)) if (key.startsWith('shipping')) data[key] = value;
        }
        const result = await api('admin/settings', { data, revision: row.revision });
        row.revision = result.revision;
        notify('Configurações aplicadas à loja.');
      } catch (err) {
        notify(err.message, true);
      } finally {
        b.disabled = false;
      }
    };
  }
  async function auditPage() {
    const { entries } = await api('admin/audit');
    $('#main').innerHTML =
      heading('Cada detalhe registrado.', 'Últimas alterações feitas pela administração.') +
      '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Responsável</th><th>Alteração</th><th>Referência</th></tr></thead><tbody>' +
      entries
        .map(
          (a) =>
            `<tr><td>${esc(new Date(a.created_at * 1000).toLocaleString('pt-BR'))}</td><td>${esc(a.name)}</td><td>${esc({ 'product.create': 'Produto criado', 'product.update': 'Produto atualizado', 'settings.update': 'Configurações salvas', 'testimonials.create': 'Depoimento criado', 'testimonials.update': 'Depoimento atualizado', 'faq.create': 'Pergunta criada', 'faq.update': 'Pergunta atualizada' }[a.action] || a.action)}</td><td>${esc(a.target)}</td></tr>`,
        )
        .join('') +
      '</tbody></table></div>' +
      (entries.length ? '' : '<p class="empty">As próximas alterações aparecerão aqui.</p>');
  }
  async function ordersPage() {
    const [data, settings] = await Promise.all([api('orders/manage'), api('admin/settings')]);
    const orderMessage = JSON.parse(settings.data).orderWhatsAppMessage || defaultOrderMessage;
    $('#main').innerHTML=heading('Pedidos e entregas','Confira o pagamento e atualize a entrega de cada pedido.')+'<div id="commerce-orders"></div>';
    if (!data.orders.length) $('#commerce-orders').textContent = 'Nenhum pedido cadastrado ainda.';
    for(const order of data.orders) {
      const card=document.createElement('article');card.className='card';
      card.innerHTML=`<h2>Pedido ${esc(order.id.slice(0,8))}</h2><p>${money(order.amount_cents)} · ${esc(order.payment_state)} · Reserva: ${esc(order.reservation_state)}</p>${integratedShipping ? '' : '<p data-delivery-summary></p>'}<button class="secondary" type="button">Abrir pedido</button><div class="order-detail"></div>`;
      const detail=card.querySelector('.order-detail');
      const deliverySummary = card.querySelector('[data-delivery-summary]');
      const updateSummary = (state, date) => {
        if (deliverySummary) {
          deliverySummary.textContent = 'Entrega pela loja: ' + (deliveryLabels[state] || deliveryLabels.to_arrange)
            + (date ? ' · ' + date.split('-').reverse().join('/') : '');
        }
      };
      updateSummary(order.delivery_state, order.delivery_date);
      async function renderDetail() {
        const data=await api('orders/'+order.id),o=data.order;
        detail.innerHTML=`<p>Pagamento: ${esc(o.paymentState)}</p><p>Entrega: ${esc(o.snapshot.address.recipient)}, ${esc(o.snapshot.address.street)}, ${esc(o.snapshot.address.number)} · ${esc(o.snapshot.address.cep)}</p><p>${o.snapshot.items.map(i=>`${esc(i.qty)} × ${esc(i.name)} (${esc(i.color)}, ${esc(i.size)})`).join('<br>')}</p><button data-reconcile class="secondary">Consultar pagamento no Asaas</button><form data-fiscal><label>Chave da nota fiscal<input name="key" inputmode="numeric" pattern="[0-9]{44}" maxlength="44" required value="${esc(o.fiscal?.key||'')}"></label><button class="secondary">Salvar nota fiscal</button></form><button data-prepare class="primary">Preparar expedição</button><div data-shipments></div>`;
        detail.querySelector('[data-reconcile]').onclick=async e=>{e.target.disabled=true;try{await api('orders/'+order.id+'/reconcile',{});await renderDetail();}catch(error){notify(error.message,true);e.target.disabled=false;}};
        detail.querySelector('[data-fiscal]').onsubmit=async e=>{e.preventDefault();try{await api('orders/'+order.id+'/fiscal',Object.fromEntries(new FormData(e.target)));notify('Nota fiscal salva.');}catch(error){notify(error.message,true);}};
        const reconcileButton = detail.querySelector('[data-reconcile]');
        if (/^[1-9]{2}\d{8,9}$/.test(o.contactPhone || '')) {
          const contact = document.createElement('a');
          const values = { nome: o.snapshot.customer?.name || o.snapshot.address.recipient, pedido: order.id.slice(0,8) };
          const url = new URL('https://wa.me/55' + o.contactPhone);
          url.search = '?text=' + encodeURIComponent(orderMessage.replace(/\{(nome|pedido)\}/g, (_, field) => values[field]));
          contact.href = url.href;
          contact.target = '_blank';
          contact.rel = 'noopener noreferrer';
          contact.className = 'secondary order-whatsapp';
          contact.textContent = 'Conversar no WhatsApp';
          reconcileButton.before(contact);
        } else {
          const notice = document.createElement('p');
          notice.textContent = 'Este pedido não tem um telefone com DDD cadastrado.';
          reconcileButton.before(notice);
        }
        if (!integratedShipping) {
          updateSummary(o.deliveryState, o.deliveryDate);
          detail.querySelector('[data-prepare]').remove();
          detail.querySelector('[data-shipments]').remove();
          const address = o.snapshot.address;
          const deliveryDetails = document.createElement('p');
          deliveryDetails.textContent = [address.complement, address.neighborhood, address.city, address.state,
            o.snapshot.customer.phone, o.snapshot.customer.email].filter(Boolean).join(' · ');
          detail.querySelectorAll('p')[1].after(deliveryDetails);
          const form = document.createElement('form');
          form.className = 'form-grid';
          form.innerHTML = `<h3>Entrega pela loja</h3>
            <label>Status da entrega<select name="state">${Object.entries(deliveryLabels).map(([state, label]) =>
              `<option value="${state}" ${state === o.deliveryState ? 'selected' : ''} ${state !== 'to_arrange' && o.paymentState !== 'paid' ? 'disabled' : ''}>${label}</option>`).join('')}</select></label>
            <label>Data da entrega<input type="date" name="date" value="${esc(o.deliveryDate || '')}"></label>
            <button class="primary">Salvar entrega</button>`;
          const state = form.elements.state, date = form.elements.date, save = form.querySelector('button');
          const updateDate = () => { date.disabled = state.value === 'to_arrange'; date.required = !date.disabled; };
          state.addEventListener('change', updateDate);
          updateDate();
          form.onsubmit = async event => {
            event.preventDefault();
            const payload = { state: state.value, date: date.disabled ? null : date.value };
            save.disabled = true;
            try {
              await api('orders/' + order.id + '/delivery', payload);
              updateSummary(payload.state, payload.date);
              notify('Entrega atualizada.');
            } catch (error) { notify(error.message, true); } finally { save.disabled = false; }
          };
          detail.append(form);
          return;
        }
        detail.querySelector('[data-prepare]').onclick=async e=>{e.target.disabled=true;try{await api('orders/'+order.id+'/shipment',{});await renderDetail();}catch(error){notify(error.message,true);e.target.disabled=false;}};
        for(const s of data.shipments) {
          const box=document.createElement('section');box.innerHTML=`<h3>Envio ${esc(s.sequence)} · ${esc(s.state)}</h3><p>Rastreio: ${esc(s.tracking||'aguardando transportadora')}</p>`;
          for(const [action,label] of [['cart','Criar etiqueta no carrinho'],['purchase','Comprar etiqueta Sandbox'],['generate','Gerar etiqueta'],['print','Obter impressão'],['reconcile','Consultar entrega'],['cancel','Cancelar etiqueta']]) {
            const button=document.createElement('button');button.className='secondary';button.type='button';button.textContent=label;
            button.onclick=async()=>{button.disabled=true;try{await api(`orders/${order.id}/shipment/${s.id}/${action}`,{});await renderDetail();}catch(error){notify(error.message,true);button.disabled=false;}};box.append(button);
          }
          if(s.print_url){const a=document.createElement('a');a.href=s.print_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Abrir etiqueta para impressão';box.append(a);}
          detail.querySelector('[data-shipments]').append(box);
        }
      }
      card.querySelector('button').onclick=()=>renderDetail().catch(e=>notify(e.message,true));
      $('#commerce-orders').append(card);
    }
  }
  async function fulfillmentPage() {
    const data=await api('orders/shipping-settings');
    if (data.sender?.document) data.sender.company_document = data.sender.document;
    const fields=[['name','Nome do remetente'],['company_document','CPF ou CNPJ (somente números)'],['state_register','Inscrição estadual (se houver)'],['phone','Telefone com DDD'],['email','E-mail'],['postal_code','CEP'],['address','Rua / Avenida'],['number','Número'],['complement','Complemento'],['district','Bairro'],['city','Cidade'],['state_abbr','UF']];
    $('#main').innerHTML=heading('Remetente e pacotes','Preencha dados reais antes de preparar uma etiqueta.')+`<form id="sender-form" class="card form-grid">${fields.map(([name,label])=>`<label>${label}<input name="${name}" value="${esc(data.sender?.[name]||'')}" ${name==='complement'?'':'required'}></label>`).join('')}<button class="primary">Salvar remetente</button></form><form id="package-form" class="card form-grid"><h2>Peso e medidas por variante</h2><label>Produto / cor / tamanho<select name="variant">${products.flatMap(p=>p.variants.map(v=>`<option value="${esc(JSON.stringify({productId:p.id,color:v.color,size:v.size}))}">${esc(p.name)} · ${esc(v.color)} · ${esc(v.size)}</option>`)).join('')}</select></label>${[['weight','Peso (kg)'],['width','Largura (cm)'],['height','Altura (cm)'],['length','Comprimento (cm)']].map(([name,label])=>`<label>${label}<input type="number" name="${name}" min="0.001" step="0.001" required></label>`).join('')}<button class="primary">Salvar pacote da variante</button></form>`;
    $('#sender-form [name="state_register"]').required = false;
    $('#sender-form').onsubmit=async e=>{e.preventDefault();try{const sender=Object.fromEntries(new FormData(e.target));const document=sender.company_document.replace(/\D/g,'');if(document.length===11){delete sender.company_document;sender.document=document;}else{sender.company_document=document;}await api('orders/shipping-settings',sender);notify('Remetente salvo.');}catch(error){notify(error.message,true);}};
    $('#package-form').onsubmit=async e=>{e.preventDefault();try{const d=Object.fromEntries(new FormData(e.target));await api('orders/sku-package',{...JSON.parse(d.variant),package:Object.fromEntries(['weight','width','height','length'].map(k=>[k,Number(d[k])]))});notify('Peso e medidas salvos. Faça uma nova cotação no checkout.');}catch(error){notify(error.message,true);}};
  }
  async function orderMailPage() {
    const data=await api('orders/mail');
    if (data.transport === 'disabled') {
      $('#main').innerHTML = heading('E-mails de pedidos', 'O envio ainda não está configurado.');
      return;
    }
    if (data.transport === 'resend_test' || data.transport === 'resend') {
      const statuses = { queued_email: 'Na fila', email_accepted: 'Aceito pelo provedor', email_review: 'Requer revisão' };
      const subjects = { order_created: 'Pedido recebido', staff_order_created: 'Aviso de novo pedido à loja', payment_confirmed: 'Pagamento confirmado' };
      $('#main').innerHTML = (data.transport === 'resend' ? heading('E-mails de pedidos', 'Acompanhe os envios ao cliente.')
        : heading('E-mails de teste', 'As mensagens são encaminhadas à caixa de teste configurada.')) +
        (data.messages.length ? data.messages.map(message =>
          `<article class="card"><h2>${esc(subjects[message.kind])}</h2><p>Pedido ${esc(message.order_id.slice(0,8))} · ${esc(statuses[message.state])} · Tentativas: ${esc(message.attempts)}</p></article>`,
        ).join('') : '<p class="empty">Nenhum e-mail de pedido enfileirado.</p>');
      return;
    }
    $('#main').innerHTML=heading('E-mails de teste','Caixa local: nenhuma mensagem é enviada a clientes.')+data.messages.map(m=>`<article class="card"><h2>${esc(m.subject)}</h2><p>${esc(m.recipient)}</p><pre>${esc(m.payload_json)}</pre></article>`).join('');
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-page],[data-edit],[data-new],[data-copy]');
    if (!b) return;
    if (b.dataset.page) {
      await navigate(b.dataset.page);
    } else if (b.hasAttribute('data-new')) openEditor(null);
    else if (b.dataset.edit) openEditor(Number(b.dataset.edit));
    else if (b.dataset.copy) {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        notify('Caminho copiado.');
      } catch {
        notify('Copie o caminho exibido abaixo da imagem.', true);
      }
    }
  });
  async function enter() {
    await api('admin/session');
    const [, health] = await Promise.all([load(), api('health')]);
    production = health.production === true;
    integratedShipping = health.integratedShipping === true;
    $('[data-page="fulfillment"]').hidden = !integratedShipping;
    $('.environment-dot').textContent = production ? (health.checkout === 'live' ? 'Produção' : 'Vendas fechadas') : 'Sandbox';
    $('[data-page="order-mail"] span').textContent = production ? 'E-mails de pedidos' : 'E-mails de teste';
    $('#admin-login').hidden = true;
    $('#admin-shell').hidden = false;
    await navigate(page);
  }
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    if (busyLogin) return;
    busyLogin = true;
    const button = e.target.querySelector('button');
    button.disabled = true;
    $('#login-feedback').textContent = 'Entrando…';
    try {
      await api('auth/login', Object.fromEntries(new FormData(e.target)));
      await enter();
      e.target.reset();
      $('#login-feedback').textContent = '';
    } catch (err) {
      $('#login-feedback').textContent = err.message;
    } finally {
      busyLogin = false;
      button.disabled = false;
    }
  };
  $('#logout').onclick = async () => {
    try {
      await api('auth/logout', {});
      location.reload();
    } catch (e) {
      notify(e.message, true);
    }
  };
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  let categoryName = '',
    categoryBusy = false;
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-category]');
    if (!button) return;
    categoryName = button.dataset.category;
    $('#category-edit-form [name="category-name"]').value = categoryName;
    $('#category-feedback').textContent = '';
    $('#delete-category').disabled = products.some((p) => p.category === categoryName);
    $('#category-dialog').showModal();
  });
  $('#close-category').onclick = () => {
    if (!categoryBusy) $('#category-dialog').close();
  };
  async function saveCategory(action) {
    if (categoryBusy) return;
    categoryBusy = true;
    $('#category-dialog')
      .querySelectorAll('button')
      .forEach((b) => (b.disabled = true));
    try {
      await api('admin/categories/manage', {
        name: categoryName,
        action,
        ...(action === 'rename'
          ? { newName: $('#category-edit-form [name="category-name"]').value }
          : {}),
      });
      $('#category-dialog').close();
      await load();
      categoryPage();
      notify('Categoria atualizada.');
    } catch (e) {
      $('#category-feedback').textContent = e.message;
    } finally {
      categoryBusy = false;
      $('#category-dialog')
        .querySelectorAll('button')
        .forEach((b) => (b.disabled = false));
      $('#delete-category').disabled = products.some((p) => p.category === categoryName);
    }
  }
  $('#category-edit-form').onsubmit = (e) => {
    e.preventDefault();
    saveCategory('rename');
  };
  $('#delete-category').onclick = () => saveCategory('delete');
  const contentDialog = $('#content-editor');
  let contentKind = 'faq',
    contentItems = [],
    contentCurrent = null,
    contentDirty = false,
    contentBusy = false;
  async function contentPage(kind) {
    contentKind = kind;
    const { items } = await api('admin/content/' + kind);
    contentItems = items;
    const testimonial = kind === 'testimonials';
    $('#main').innerHTML =
      heading(
        testimonial ? 'Histórias que ficam.' : 'Respostas com cuidado.',
        testimonial
          ? 'Experiências reais de quem faz parte da Mascavo.'
          : 'Clareza em cada etapa da experiência com a loja.',
        `<button class="primary" id="new-content">${testimonial ? 'Novo depoimento' : 'Nova pergunta'}</button>`,
      ) +
      `<div class="card"><p class="hint">${testimonial ? 'Publique relatos reais, com autorização de quem enviou. Fotos e avaliações são opcionais.' : 'As respostas publicadas aparecem na página de dúvidas frequentes. Revise as condições da loja antes de publicar políticas de compra.'}</p><a href="${testimonial ? '/#depoimentos' : '/duvidas-frequentes'}" target="_blank" rel="noopener" class="secondary">Ver no site</a></div>` +
      '<div class="toolbar"><input id="content-search" placeholder="Buscar conteúdo…" aria-label="Buscar conteúdo"><select id="content-status" aria-label="Filtrar publicação"><option value="">Todos os status</option><option value="1">Publicados</option><option value="0">Rascunhos</option></select></div><div class="editorial-admin-list" id="content-items"></div>';
    function draw() {
      const term = $('#content-search').value.toLocaleLowerCase(),
        filter = $('#content-status').value;
      const rows = items.filter(
        (item) =>
          JSON.stringify(item).toLocaleLowerCase().includes(term) &&
          (filter === '' || String(item.published) === filter),
      );
      $('#content-items').innerHTML = rows.length
        ? rows
            .map(
              (item) =>
                `<article class="card editorial-admin-card"><div><span class="badge ${item.published ? '' : 'off'}">${item.published ? 'Publicado' : 'Rascunho'}</span><span class="hint"> · posição ${item.sort_order}</span><h2>${esc(testimonial ? item.author_name : item.question)}</h2><p class="editorial-admin-copy">${esc(testimonial ? item.quote : item.answer)}</p><small class="hint">${esc(testimonial ? item.author_detail : item.category)}</small></div><button class="secondary" data-content-edit="${esc(item.id)}">Editar</button></article>`,
            )
            .join('')
        : '<div class="empty"><h2>A próxima história começa aqui.</h2><p>Nenhum conteúdo encontrado. Adicione um novo item ou ajuste os filtros.</p></div>';
      $('#content-items')
        .querySelectorAll('[data-content-edit]')
        .forEach(
          (button) =>
            (button.onclick = () =>
              editContent(items.find((item) => item.id === button.dataset.contentEdit))),
        );
    }
    $('#content-search').oninput = draw;
    $('#content-status').onchange = draw;
    $('#new-content').onclick = () => editContent(null);
    draw();
  }
  function editContent(item) {
    contentCurrent = item;
    contentDirty = false;
    $('#content-discard').hidden = true;
    $('#content-feedback').textContent = '';
    const testimonial = contentKind === 'testimonials',
      host = $('#content-fields');
    $('#content-editor-title').textContent = testimonial
      ? item
        ? 'Editar depoimento'
        : 'Uma nova história.'
      : item
        ? 'Editar resposta'
        : 'Uma nova resposta.';
    host.innerHTML =
      '<div class="form-grid">' +
      (testimonial
        ? `<label>Nome de quem enviou<input name="author_name" required maxlength="100" value="${esc(item?.author_name || '')}"></label><label>Identificação (opcional)<input name="author_detail" maxlength="100" value="${esc(item?.author_detail || '')}" placeholder="Ex.: cidade ou perfil"></label><label class="full">Depoimento<textarea name="quote" required maxlength="1500">${esc(item?.quote || '')}</textarea></label><label class="full">Caminho da foto (opcional)<input name="avatar_url" value="${esc(item?.avatar_url || '')}" placeholder="/media/… ou assets/…"></label><label class="secondary">Enviar foto<input type="file" id="testimonial-upload" accept="image/png,image/jpeg,image/webp" hidden></label><label>Avaliação (opcional)<select name="rating"><option value="">Sem avaliação</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${item?.rating === n ? 'selected' : ''}>${n} de 5 estrelas</option>`).join('')}</select></label>`
        : `<label class="full">Pergunta<input name="question" required maxlength="200" value="${esc(item?.question || '')}"></label><label class="full">Resposta<textarea name="answer" required maxlength="4000">${esc(item?.answer || '')}</textarea></label><label>Assunto<input name="category" required maxlength="60" value="${esc(item?.category || 'Geral')}"></label>`) +
      `<label>Posição na lista<input type="number" name="sort_order" min="0" max="10000" step="1" required value="${item?.sort_order ?? contentItems.length}"></label><label class="check full"><input type="checkbox" name="published" ${item?.published ? 'checked' : ''}>Publicado no site</label></div><p class="hint">Sem marcar publicação, este conteúdo fica como rascunho. Textos são exibidos sem formatação HTML.</p>`;
    if (testimonial)
      $('#testimonial-upload').onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        contentBusy = true;
        $('#content-save').disabled = true;
        try {
          host.querySelector('[name="avatar_url"]').value = await upload(file);
          contentDirty = true;
          notify('Foto enviada. Salve o depoimento para aplicar.');
        } catch (error) {
          $('#content-feedback').textContent = error.message;
        } finally {
          contentBusy = false;
          $('#content-save').disabled = false;
          event.target.value = '';
        }
      };
    contentDialog.showModal();
  }
  function closeContent() {
    if (contentBusy) return;
    if (contentDirty) {
      $('#content-discard').hidden = false;
      $('#content-keep').focus();
    } else contentDialog.close();
  }
  contentDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeContent();
  });
  contentDialog
    .querySelectorAll('[data-content-close]')
    .forEach((button) => (button.onclick = closeContent));
  $('#content-form').oninput = () => (contentDirty = true);
  $('#content-keep').onclick = () => ($('#content-discard').hidden = true);
  $('#content-discard-confirm').onclick = () => {
    contentDirty = false;
    contentDialog.close();
  };
  $('#content-form').onsubmit = async (event) => {
    event.preventDefault();
    if (contentBusy) return;
    contentBusy = true;
    $('#content-save').disabled = true;
    const form = new FormData(event.target),
      body = {
        published: form.has('published'),
        sort_order: Number(form.get('sort_order')),
        ...(contentCurrent ? { revision: contentCurrent.revision } : {}),
      };
    if (contentKind === 'testimonials')
      Object.assign(body, {
        author_name: form.get('author_name'),
        author_detail: form.get('author_detail'),
        quote: form.get('quote'),
        avatar_url: form.get('avatar_url'),
        rating: form.get('rating') ? Number(form.get('rating')) : null,
      });
    else
      Object.assign(body, {
        question: form.get('question'),
        answer: form.get('answer'),
        category: form.get('category'),
      });
    try {
      await api('admin/content/' + contentKind + '/' + (contentCurrent?.id || 'new'), body);
      contentDirty = false;
      contentDialog.close();
      await contentPage(contentKind);
      notify('Conteúdo salvo. Atualize o site para ver as mudanças.');
    } catch (error) {
      $('#content-feedback').textContent = error.message;
    } finally {
      contentBusy = false;
      $('#content-save').disabled = false;
    }
  };
  window.addEventListener('beforeunload', (event) => {
    if (contentDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  enter().catch(() => {});
})();
