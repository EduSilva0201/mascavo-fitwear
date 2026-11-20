(() => {
  const list = document.getElementById('faq-list'),
    status = document.getElementById('faq-status'),
    filters = document.getElementById('faq-filters'),
    search = document.getElementById('faq-search'),
    retry = document.getElementById('faq-retry');
  let entries = [],
    category = 'Todos';
  const normalize = (text) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
  function render() {
    const term = normalize(search.value.trim()),
      items = entries.filter(
        (item) =>
          (category === 'Todos' || item.category === category) &&
          normalize(item.question + ' ' + item.answer).includes(term),
      );
    status.textContent = items.length
      ? `${items.length} resposta(s) para você.`
      : entries.length
        ? 'Nenhuma resposta encontrada. Tente outro termo ou assunto.'
        : 'As respostas estão sendo preparadas. Fale com a Mascavo pelos canais da loja.';
    list.replaceChildren();
    for (const item of items) {
      const details = document.createElement('details');
      details.name = 'mascavo-faq';
      const summary = document.createElement('summary'),
        label = document.createElement('span'),
        plus = document.createElement('span');
      label.textContent = item.question;
      plus.textContent = '+';
      plus.className = 'faq-plus';
      plus.setAttribute('aria-hidden', 'true');
      summary.append(label, plus);
      const body = document.createElement('div');
      body.className = 'faq-answer';
      body.textContent = item.answer;
      details.append(summary, body);
      list.append(details);
    }
    filters
      .querySelectorAll('button')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === category)));
  }
  async function load() {
    retry.hidden = true;
    status.textContent = 'Carregando as respostas…';
    try {
      const response = await fetch('/api/v1/content');
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!Array.isArray(data.faq)) throw Error();
      entries = data.faq;
      filters.replaceChildren();
      for (const name of ['Todos', ...new Set(entries.map((item) => item.category))]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.onclick = () => {
          category = name;
          render();
        };
        filters.append(b);
      }
      category = 'Todos';
      render();
    } catch {
      status.textContent = 'Não foi possível carregar as respostas. Tente novamente.';
      retry.hidden = false;
    }
  }
  search.addEventListener('input', render);
  retry.onclick = load;
  void load();
})();
