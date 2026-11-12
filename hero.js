(() => {
  const hero = document.querySelector('.campaign-hero');
  if (!hero) return;
  const slides = [...hero.querySelectorAll('.campaign-slide')];
  const pause = hero.querySelector('[data-campaign-pause]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = 0, paused = false, focused = false, visible = true, timer;
  function schedule() {
    clearTimeout(timer);
    hero.dataset.motionPaused = String(paused || focused || !visible || document.hidden || motion.matches);
    if (!paused && !focused && visible && !document.hidden && !motion.matches)
      timer = setTimeout(() => show(active + 1), 5000);
  }
  function show(index) {
    active = index % slides.length;
    slides.forEach((slide, i) => {
      const current = i === active;
      slide.classList.toggle('is-active', current);
      slide.inert = !current;
      slide.setAttribute('aria-hidden', String(!current));
    });
    schedule();
  }
  function updatePause() {
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = paused ? 'Retomar' : 'Pausar';
    pause.setAttribute('aria-label', (paused ? 'Retomar' : 'Pausar') + ' troca autom\u00e1tica');
    hero.querySelector('.campaign-controls').hidden = motion.matches;
    schedule();
  }
  pause.onclick = () => { paused = !paused; updatePause(); };
  hero.addEventListener('focusin', () => { focused = true; schedule(); });
  hero.addEventListener('focusout', () => setTimeout(() => { focused = hero.contains(document.activeElement); schedule(); }, 0));
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', updatePause);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }).observe(hero);
  show(0); updatePause();
})();
