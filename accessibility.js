(() => {
  const root = document.documentElement;
  const key = 'mascavo:accessibility:v1';
  const options = {
    zoom: 'Ampliar conteúdo',
    contrast: 'Alto contraste',
    links: 'Destacar links',
    spacing: 'Aumentar espaçamento do texto',
    motion: 'Reduzir animações',
  };
  let preferences = {};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const name of Object.keys(options)) preferences[name] = saved?.[name] === true;
  } catch {}

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'a11y-trigger';
  trigger.setAttribute('aria-label', 'Opções de acessibilidade');
  trigger.title = 'Opções de acessibilidade';
  trigger.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><path d="M6.5 9.5 12 11l5.5-1.5M12 11v4m0-2-3 5m3-5 3 5"/></svg>';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'a11y-panel');
  trigger.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('dialog');
  panel.id = 'a11y-panel';
  panel.className = 'a11y-panel';
  panel.setAttribute('aria-labelledby', 'a11y-title');
  panel.innerHTML = `
    <header><h2 id="a11y-title">Acessibilidade</h2><button type="button" data-close aria-label="Fechar acessibilidade">✕</button></header>
    <p>Ajuste a loja para uma leitura mais confortável.</p>
    <div class="a11y-options">${Object.entries(options).map(([name, label]) => `<button type="button" data-option="${name}" aria-pressed="false">${label}<span aria-hidden="true">✓</span></button>`).join('')}</div>
    <p>Para tradução em Libras, use o botão azul do VLibras na lateral da página.</p>
    <button type="button" data-reset>Restaurar preferências</button>
    <p class="a11y-status" role="status" aria-live="polite"></p>`;
  document.body.append(panel);
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileLayout = matchMedia('(max-width: 620px)');
  function placeTrigger() {
    (mobileLayout.matches && mobileMenu ? mobileMenu : document.body).append(trigger);
  }
  placeTrigger();
  mobileLayout.addEventListener('change', placeTrigger);

  function apply() {
    for (const name of Object.keys(options)) {
      const enabled = preferences[name] === true;
      root.classList.toggle(`a11y-${name}`, enabled);
      panel.querySelector(`[data-option="${name}"]`).setAttribute('aria-pressed', String(enabled));
    }
  }
  function save() {
    apply();
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch {}
  }
  trigger.addEventListener('click', () => {
    panel.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  });
  panel.querySelector('[data-close]').addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  });
  panel.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
    const name = button.dataset.option;
    preferences[name] = !preferences[name];
    save();
    if (name === 'motion' && preferences.motion) window.mascavoPreloader?.finish();
  }));
  panel.querySelector('[data-reset]').addEventListener('click', () => {
    preferences = {};
    save();
    panel.querySelector('[role="status"]').textContent = 'Preferências restauradas.';
  });
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    try { preferences = JSON.parse(event.newValue) || {}; } catch { preferences = {}; }
    apply();
  });
  apply();
  if (preferences.motion) window.mascavoPreloader?.finish();
})();
