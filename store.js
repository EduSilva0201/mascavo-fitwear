// Public settings contain editorial/contact data only, never credentials.
fetch('/api/v1/store')
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    const s = data?.settings;
    if (!s) return;
    if (s.storeName) document.title = s.storeName + ' | Fitwear';
    document.querySelectorAll('.campaign-slide').forEach((slide, index) => {
      const n = index + 1;
      if (s['heroTitle' + n]) slide.querySelector('h1,h2').textContent = s['heroTitle' + n];
      if (s['heroText' + n])
        slide.querySelector('.campaign-copy > p').textContent = s['heroText' + n];
      if (s['heroImage' + n]) slide.querySelector('.campaign-image').src = s['heroImage' + n];
    });
    const footer = document.querySelector('.compact-footer-meta > span');
    if (footer && s.storeName) footer.textContent = '© ' + s.storeName;
    if (s.announcement) {
      const bar = document.createElement('div');
      bar.className = 'store-announcement';
      bar.textContent = s.announcement;
      document.querySelector('main')?.prepend(bar);
    }
    const nav = document.querySelector('.compact-footer nav');
    if (nav) {
      for (const [text, url] of [
        ['WhatsApp', s.whatsapp ? 'https://wa.me/' + s.whatsapp : null],
        ['Instagram', s.instagram ? 'https://instagram.com/' + s.instagram : null],
        ['E-mail', s.contactEmail ? 'mailto:' + s.contactEmail : null],
      ]) {
        if (!url) continue;
        const a = document.createElement('a');
        a.textContent = text;
        a.href = url;
        a.rel = 'noopener noreferrer';
        if (!url.startsWith('mailto:')) a.target = '_blank';
        nav.append(a);
      }
    }
    if (s.tagline) {
      const p = document.querySelector('.footer-store-tagline') || document.createElement('p');
      p.className = 'footer-store-tagline';
      p.textContent = s.tagline;
      document.querySelector('.compact-footer')?.append(p);
    }
  })
  .catch(() => {});
