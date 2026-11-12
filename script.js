(async () => {
const uiIcon = (name) => `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
let products;
try {
  const response = await fetch('/api/v1/catalog');
  if (!response.ok) throw new Error('Catalog request failed');
  const data = await response.json();
  products = data.products;
} catch {
  const host = document.querySelector('#products');
  host.className = 'catalog-empty';
  host.setAttribute('role', 'status');
  host.innerHTML = '<h3>Não foi possível carregar a coleção.</h3><p>Tente novamente em instantes.</p><button type="button" class="campaign-cta" id="catalog-retry">Tentar novamente</button>';
  document.querySelector('#catalog-retry').onclick = () => location.reload();
  return;
}

const fallbackImage =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 850"><rect width="700" height="850" fill="#f2d7b6"/><text x="350" y="395" text-anchor="middle" font-family="Georgia" font-size="52" fill="#40210f">MASCAVO</text><text x="350" y="448" text-anchor="middle" font-family="Arial" letter-spacing="8" font-size="20" fill="#73462d">FITWEAR</text><text x="350" y="520" text-anchor="middle" font-family="Arial" font-size="20" fill="#73462d">Imagem ilustrativa</text></svg>',
  );
const money = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  photo = (p, color) => (!color && p.gallery && p.gallery[cardSelections[p.id]?.imageIndex || 0]) ? p.gallery[cardSelections[p.id]?.imageIndex || 0].src : p.images ? p.images[color || cardSelections[p.id]?.color || p.colors[0]] : 'https://images.unsplash.com/' + p.image + '?w=750&q=85';
const productSizes = (p) => p.sizes || (p.category === 'Acessórios' ? ['Único'] : ['P', 'M', 'G', 'GG']);
const stockLimit = (p, color, size) => p.stock ? (p.stock[color]?.[size] ?? 0) : 99;
let filter = 'Todos',
  selectedSize = 'M',
  selectedColor = '';
const cardSelections = {};
const colorHex = {
  Cacau: '#73462D',
  Chocolate: '#40210F',
  Preto: '#1c1c1c',
  Areia: '#F2D7B6',
  Caramelo: '#BF8B5E',
  Vinho: '#6e1737',
  'Rosa bebê': '#f4b6cf',
  'Azul petróleo': '#20334c',
};
let cart = [];
try {
  const saved = JSON.parse(localStorage.getItem('mascavo-cart') || '[]');
  if (Array.isArray(saved))
    cart = saved.filter((x) => {
      const p = products.find((p) => p.id === x.id);
      return p && Number.isInteger(x.qty) && x.qty > 0 && p.colors.includes(x.color) && productSizes(p).includes(x.size) && x.qty <= stockLimit(p, x.color, x.size);
    });
} catch (e) {}
const $ = (s) => document.querySelector(s);
const productDialog = $('#product-dialog'),
  cartDialog = $('#cart-dialog');
function persist() {
  try {
    localStorage.setItem('mascavo-cart', JSON.stringify(cart));
  } catch (e) {}
  updateCount();
}
function updateCount() {
  const count = cart.reduce((n, x) => n + x.qty, 0);
  $('#count').textContent = count;
  $('#count').hidden = count === 0;
  $('#cart-toggle').setAttribute('aria-label', `Abrir sacola, ${count} ${count === 1 ? 'item' : 'itens'}`);
}
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.style.display = 'none'), 2200);
}
function selection(p) {
  return cardSelections[p.id] || (cardSelections[p.id] = { color: '', size: '' });
}
function cardOptions(p) {
  const s = selection(p);
  return (
    '<div class="card-variants"><label>Cor</label><div class="swatches">' +
    p.colors
      .map(
        (c) =>
          '<button type="button" class="swatch ' +
          (s.color === c ? 'active' : '') +
          '" data-card-color="' +
          p.id +
          '" data-color="' +
          c +
          '" title="' +
          c +
          '" aria-label="Cor ' +
          c +
          '" aria-pressed="' +
          (s.color === c) +
          '" style="--swatch:' +
          colorHex[c] +
          '"></button>',
      )
      .join('') +
    '</div><span class="chosen-color">' +
    (s.color || 'Selecione uma cor') +
    '</span>' +
    (p.category === 'Acessórios'
      ? ''
      : '<label>Tamanho</label><div class="card-sizes">' +
        productSizes(p)
          .map(
            (t) =>
              '<button type="button" data-card-size="' +
              p.id +
              '" data-value="' +
              t +
              '" class="' +
              (s.size === t ? 'active' : '') +
              '" aria-pressed="' +
              (s.size === t) +
              '">' +
              t +
              '</button>',
          )
          .join('') +
        '</div>') +
    '</div>'
  );
}
function renderProducts() {
  const matching = products.filter(p => filter === 'Todos' || p.category === filter);
  $('#catalog-title').textContent = filter === 'Todos' ? 'Nossa coleção' : filter;
  $('#catalog-empty').hidden = matching.length > 0;
  $('#products').hidden = matching.length === 0;
  $('#filters').innerHTML = ['Todos', 'Conjuntos', 'Macaquinho', 'Leggings', 'Tops', 'Shorts', 'Acessórios']
    .map(
      (c) =>
        '<button data-filter="' +
        c +
        '" class="' +
        (filter === c ? 'active' : '') +
        '">' +
        c +
        '</button>',
    )
    .join('');
  $('#products').innerHTML = matching
    .map(
      (p) =>
        '<article class="product"><div class="product-photo"><button class="product-image-link" data-open="' + p.id + '" aria-label="Ver detalhes de ' + p.name + '"><img src="' +
        photo(p) +
        '" loading="lazy" alt="Foto ilustrativa de ' +
        p.name +
        '"></button>' +
        (p.best ? '<span class="bestseller">' + uiIcon('star') + 'Mais vendido</span>' : '') +
        '</div>' +
        (p.gallery ? '<div class="product-thumbnails" aria-label="Fotos de ' + p.name + '">' + p.gallery.map((image, i) => '<button type="button" data-gallery-product="' + p.id + '" data-gallery-index="' + i + '" aria-label="Ver ' + image.label + '" aria-pressed="' + ((cardSelections[p.id]?.imageIndex || 0) === i) + '"><img src="' + image.src + '" alt="" loading="lazy"></button>').join('') + '</div>' : '') +
        '<div class="product-info"><small>' +
        p.category +
        '</small><h3><button class="product-name-link" data-open="' + p.id + '">' +
        p.name +
        '</button></h3><strong>' +
        money(p.price) +
        '</strong>' +
        (p.provisional ? '<small class="provisional-note">Valor provisório</small>' : '') +
        '<div class="catalog-color-line">' + p.colors.map(c => '<button type="button" class="catalog-color" data-card-color="' + p.id + '" data-color="' + c + '" style="--swatch:' + colorHex[c] + '" title="' + c + '" aria-label="Ver ' + p.name + ' em ' + c + '" aria-pressed="' + ((selection(p).color || p.colors[0]) === c) + '"></button>').join('') + '<span>' + productSizes(p).join(' / ') + '</span></div>' +
        '<div class="product-actions"><button class="view" data-open="' +
        p.id +
        '">' + uiIcon('bag') + 'Escolher minha peça</button></div></div></article>',
    )
    .join('');
}
let detailProduct = null;
function openProduct(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;
  detailProduct = p;
  selectedColor = selection(p).color || p.colors[0];
  selectedSize = selection(p).size || '';
  $('#product-detail').innerHTML = '<div class="product-detail-layout"><div class="detail-gallery"><img class="detail-img" src="' + photo(p, selectedColor) + '" alt="' + p.name + '"><div class="product-thumbnails">' + p.gallery.map((im,i) => '<button type="button" data-detail-image="' + i + '" aria-label="Ver ' + im.label + '"><img src="' + im.src + '" alt=""></button>').join('') + '</div></div><div class="detail-copy"><span class="kicker">MASCAVO / ' + p.category + '</span><h2 id="detail-title">' + p.name + '</h2><strong class="detail-price">' + money(p.price) + '</strong><p class="provisional-note">Preço e estoque provisórios para testes</p><p class="detail-description">' + p.description + '</p><p>Cor: <span id="detail-color">' + selectedColor + '</span></p><div class="swatches">' + p.colors.map(c => '<button type="button" class="swatch" data-modal-color="' + c + '" style="--swatch:' + colorHex[c] + '" aria-label="Cor ' + c + '" aria-pressed="' + (c === selectedColor) + '"></button>').join('') + '</div><p>Escolha seu tamanho</p><div class="sizes">' + productSizes(p).map(s => '<button type="button" data-size="' + s + '" aria-pressed="' + (s === selectedSize) + '">' + s + '</button>').join('') + '</div><p id="detail-feedback" role="status"></p><button class="primary detail-add" data-add="' + p.id + '">' + uiIcon('bag') + 'Adicionar à sacola</button></div></div>';
  if (!productDialog.open) productDialog.showModal();
}

const searchDialog = $('#search-dialog');
const normalizeSearch = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderSearch() {
  const words = normalizeSearch($('#product-search').value.trim()).split(/\s+/).filter(Boolean);
  const results = products.filter(p => words.every(word => normalizeSearch([p.name,p.category,...p.colors].join(' ')).includes(word)));
  const host = $('#search-results'); host.replaceChildren();
  $('#search-status').textContent = words.length ? (results.length ? results.length + ' peça(s) para explorar' : 'Nenhuma peça encontrada. Tente outro nome ou cor.') : 'Explore a coleção';
  for (const p of results) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'search-result';
    const matchingColor = p.colors.find(color => words.some(word => normalizeSearch(color).includes(word)));
    const img = document.createElement('img'); img.src = photo(p,matchingColor || p.colors[0]); img.alt = ''; img.loading = 'lazy';
    const copy = document.createElement('span');
    const category = document.createElement('small');category.textContent = p.category;
    const name = document.createElement('strong');name.textContent = p.name;
    const colors = document.createElement('span');colors.className='search-colors';colors.textContent = p.colors.join(' / ');
    copy.append(category,name,colors);
    const price = document.createElement('span');price.className='search-price';price.textContent = money(p.price);
    button.append(img,copy,price);
    button.onclick = () => { if (matchingColor) {selection(p).color = matchingColor; selection(p).imageIndex = Math.max(0,p.gallery.findIndex(im=>im.color===matchingColor));} searchDialog.close();openProduct(p.id); };
    host.append(button);
  }
}
function openSearch() {
  $('#product-search').value = ''; renderSearch();
  if (!searchDialog.open) searchDialog.showModal();
  $('#product-search').focus();
}
searchDialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchDialog.close(); } });
$('#product-search').addEventListener('input', renderSearch);
$('#product-search').addEventListener('keydown', e => {
 if (e.key === 'ArrowDown') { e.preventDefault(); $('#search-results button')?.focus(); }
 if (e.key === 'Enter' && $('#search-results').children.length === 1) { e.preventDefault(); $('#search-results button').click(); }
});
document.addEventListener('keydown', e => {
 if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !productDialog.open && !cartDialog.open && !$('#account-dialog').open) { e.preventDefault(); openSearch(); }
});

function add(id, size, color) {
  const p = products.find((p) => p.id === id);
  if (!p || !p.colors.includes(color) || !productSizes(p).includes(size)) return;
  const limit = stockLimit(p, color, size);
  const x = cart.find((x) => x.id === id && x.size === size && x.color === color);
  if ((x?.qty || 0) >= limit) { if (productDialog.open) $('#detail-feedback').textContent = 'Quantidade disponível atingida.'; return false; }
  if (x) x.qty = Math.min(limit, x.qty + 1);
  else cart.push({ id, size, color, qty: 1 });
  persist();
  toast('✓ ' + p.name + ' adicionado à sacola');
  return true;
}
function cartView() {
  const total = cart.reduce(
    (n, x) => n + (products.find((p) => p.id === x.id)?.price || 0) * x.qty,
    0,
  );
  $('#cart-heading-count').textContent = '(' + cart.reduce((n, x) => n + x.qty, 0) + ')';
  $('#cart-items').innerHTML = cart.length
    ? cart
        .map((x, i) => {
          const p = products.find((p) => p.id === x.id);
          return (
            '<div class="cart-row"><img src="' +
            photo(p, x.color) +
            '" alt=""><div><strong>' +
            p.name +
            '</strong><small>Cor ' +
            (x.color || p.colors[0]) +
            ' · Tamanho ' +
            x.size +
            ' · ' +
            money(p.price) +
            '</small><div class="quantity"><button data-qty="' +
            i +
            '" data-delta="-1" aria-label="Diminuir quantidade">−</button><span>' +
            x.qty +
            '</span><button data-qty="' +
            i +
            '" data-delta="1" aria-label="Aumentar quantidade">+</button></div></div><div><strong>' +
            money(p.price * x.qty) +
            '</strong><br><button class="remove" data-remove="' +
            i +
            '">Remover</button></div></div>'
          );
        })
        .join('')
    : '<p>Sua sacola está vazia. Explore nossos produtos!</p>';
  $('#cart-summary').innerHTML = cart.length
    ? '<div class="summary"><span>Subtotal</span><span>' +
      money(total) +
      '</span></div><button class="primary" disabled style="opacity:.55;cursor:not-allowed">Finalizar compra (em breve)</button><p class="demo-note">Demonstração: pagamento e frete serão integrados posteriormente.</p>'
    : '';
}
document.addEventListener(
  'error',
  (e) => {
    if (e.target instanceof HTMLImageElement && !e.target.dataset.fallback) {
      e.target.dataset.fallback = '1';
      e.target.src = fallbackImage;
    }
  },
  true,
);
document.addEventListener('click', (e) => {
  const menuLink = e.target.closest('[data-menu-filter]');
  if (menuLink) {
    filter = menuLink.dataset.menuFilter;
    renderProducts();
    document.querySelector('#mobile-menu').hidden = true;
    document.querySelector('#menu-toggle').setAttribute('aria-expanded', 'false');
  }
  if (e.target.closest('#account-toggle,#mobile-account')) {
    openAccount();
    document.querySelector('#mobile-menu').hidden = true;
  }
  if (e.target.closest('#menu-toggle')) {
    const menu = document.querySelector('#mobile-menu');
    menu.hidden = !menu.hidden;
    document.querySelector('#menu-toggle').setAttribute('aria-expanded', String(!menu.hidden));
  }
  if (e.target.closest('.nav-drop-trigger')) {
    const b = e.target.closest('.nav-drop-trigger');
    b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true'));
  }
  const a = e.target.closest('[data-go]');
  if (a) {
    filter = a.dataset.go;
    renderProducts();
  }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.galleryProduct) {
    const p = products.find(p => p.id === Number(b.dataset.galleryProduct));
    selection(p).imageIndex = Number(b.dataset.galleryIndex);
    const image = p.gallery[selection(p).imageIndex];
    if (image.color) selection(p).color = image.color;
    renderProducts();
    document.querySelector(`[data-gallery-product="${p.id}"][data-gallery-index="${selection(p).imageIndex}"]`)?.focus({preventScroll:true});
  }
  if (b.dataset.filter) {
    filter = b.dataset.filter;
    renderProducts();
  }
  if (b.dataset.open) openProduct(Number(b.dataset.open));
  if (b.dataset.cardColor) {
    const p = products.find((p) => p.id === Number(b.dataset.cardColor));
    selection(p).color = b.dataset.color;
    if (p.gallery?.some(image => image.color)) {
      const imageIndex = p.gallery.findIndex(image => image.color === b.dataset.color);
      selection(p).imageIndex = Math.max(0, imageIndex);
    }
    renderProducts();
    document.querySelector(`[data-card-color="${p.id}"][data-color="${b.dataset.color}"]`)?.focus({preventScroll:true});
  }
  if (b.dataset.cardSize) {
    const p = products.find((p) => p.id === Number(b.dataset.cardSize));
    selection(p).size = b.dataset.value;
    renderProducts();
  }
  if (b.dataset.quick) {
    const p = products.find((p) => p.id === Number(b.dataset.quick)),
      s = selection(p);
    if (!s.color) {
      toast('Selecione a cor antes de adicionar');
      return;
    }
    if (p.category !== 'Acessórios' && !s.size) {
      toast('Selecione o tamanho antes de adicionar');
      return;
    }
    add(p.id, p.category === 'Acessórios' ? 'Único' : s.size, s.color);
  }
  if (b.dataset.detailImage !== undefined && detailProduct) {
    const image = detailProduct.gallery[Number(b.dataset.detailImage)];
    if (image.color) selectedColor = image.color;
    $('.detail-img').src = image.src;
    $('#detail-color').textContent = selectedColor;
    document.querySelectorAll('[data-modal-color]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.modalColor === selectedColor)));
  }
  if (b.dataset.modalColor) {
    selectedColor = b.dataset.modalColor;
    $('.detail-img').src = photo(detailProduct, selectedColor);
    $('#detail-color').textContent = selectedColor;
    document.querySelectorAll('[data-modal-color]').forEach(el => el.setAttribute('aria-pressed', String(el === b)));
    document
      .querySelectorAll('[data-modal-color]')
      .forEach((x) => x.classList.toggle('active', x === b));
  }
  if (b.dataset.size) {
    selectedSize = b.dataset.size;
    if (productDialog.open) $('#detail-feedback').textContent = "";
    document.querySelectorAll('[data-size]').forEach(el => el.setAttribute('aria-pressed', String(el === b)));
    document.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('active', x === b));
  }
  if (b.dataset.add) {
    if (!selectedSize) { $('#detail-feedback').textContent = 'Selecione um tamanho para continuar.'; return; }
    if (add(Number(b.dataset.add), selectedSize, selectedColor)) {
      productDialog.close(); cartView(); cartDialog.showModal();
    }
  }
  if (b.dataset.qty) {
    const i = Number(b.dataset.qty);
    cart[i].qty += Number(b.dataset.delta);
    if (cart[i].qty <= 0) cart.splice(i, 1);
    else {
      const item = cart[i], product = products.find(p => p.id === item.id);
      item.qty = Math.min(stockLimit(product, item.color, item.size), item.qty);
    }
    persist();
    cartView();
  }
  if (b.dataset.remove) {
    cart.splice(Number(b.dataset.remove), 1);
    persist();
    cartView();
  }
  if (b.id === 'cart-toggle') {
    cartView();
    cartDialog.showModal();
  }
  if (b.id === 'checkout-login') {
    cartDialog.close();
    openAccount();
  }
  if (b.hasAttribute('data-close')) b.closest('dialog').close();
  if (b.id === 'search-toggle') openSearch();
  if (b.hasAttribute('data-footer-account')) openAccount();
  if (b.hasAttribute('data-open-bag')) { cartView(); cartDialog.showModal(); }
});
document.addEventListener('mascavo:open-product', event => {
  const p = products.find(p => p.id === event.detail?.id);
  if (!p) return;
  if (p.colors.includes(event.detail.color)) selection(p).color = event.detail.color;
  openProduct(p.id);
});
renderProducts();
updateCount();
document.querySelectorAll('.product img,.category img,.detail-img,.cart-row img').forEach((img) =>
  img.addEventListener(
    'error',
    () => {
      img.src = fallbackImage;
    },
    { once: true },
  ),
);

})();
