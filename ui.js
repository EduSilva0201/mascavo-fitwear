(() => {
  const header = document.querySelector('.navbar');
  if (!header) return;
  let scheduled = false;
  function update() {
    header.classList.toggle('is-compact', scrollY > 100);
    scheduled = false;
  }
  addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }, {passive:true});
  update();
})();

(() => {
  const section = document.querySelector('.detail-features');
  if (!section) return;
  const items = [...section.querySelectorAll('[data-feature]')];
  items.forEach(item => item.addEventListener('toggle', () => {
    if (!item.open) return;
    items.forEach(other => { if (other !== item) other.open = false; });
    section.querySelectorAll('[data-feature-photo]').forEach(photo => {
      photo.hidden = photo.dataset.featurePhoto !== item.dataset.feature;
    });
  }));
})();
