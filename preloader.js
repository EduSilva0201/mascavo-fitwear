(() => {
  const boot = window.mascavoPreloader;
  if (!boot || boot.finished) {
    document.getElementById('preloader')?.remove();
    return;
  }
  const overlay = document.getElementById('preloader');
  if (!overlay) {
    boot.finish();
    return;
  }
  const progress = overlay.querySelector('[role="progressbar"]');
  let completed = 0;
  function settled() {
    if (boot.finished) return;
    completed++;
    progress.style.setProperty('--entry-progress', String(completed / 3));
    progress.setAttribute('aria-valuenow', String(completed));
    progress.setAttribute('aria-valuetext', `${completed} de 3 recursos iniciais verificados`);
  }
  // Observe existing requests; do not fetch products, duplicate images or wait for window.load.
  function imageReady(img, fallback) {
    if (!img) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        img.removeEventListener('load', finish);
        img.removeEventListener('error', finish);
        if (img.naturalWidth) {
          try {
            await img.decode();
          } catch {}
        } else fallback?.();
        resolve();
      };
      if (img.complete) void finish();
      else {
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
      }
    });
  }
  async function reveal() {
    if (boot.finished) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      boot.finish();
      return;
    }
    document.documentElement.classList.add('preloader-revealing');
    overlay.classList.add('is-leaving');
    const onEnd = (event) => {
      if (event.target === overlay && event.propertyName === 'transform') boot.finish();
    };
    overlay.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(boot.finish, 650);
  }
  try {
    const dom = (
      document.readyState === 'loading'
        ? new Promise((resolve) =>
            document.addEventListener('DOMContentLoaded', resolve, { once: true }),
          )
        : Promise.resolve()
    ).then(settled);
    const logo = imageReady(document.getElementById('preloader-logo'), () => {
      document.getElementById('preloader-logo').hidden = true;
      overlay.querySelector('.preloader-wordmark').hidden = false;
    }).then(settled);
    const hero = imageReady(
      document.querySelector('.campaign-slide.is-active .campaign-image'),
    ).then(settled);
    const entrance = Promise.all(
      overlay
        .querySelector('.preloader-brand')
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
    void Promise.all([dom, logo, hero, entrance]).then(reveal).catch(boot.finish);
  } catch {
    boot.finish();
  }
})();
