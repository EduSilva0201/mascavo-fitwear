import { useLayoutEffect, useRef } from 'react';

// Adapted from the supplied SignIn2 reference. Existing authenticated forms are
// retained as DOM nodes so their validation, CSRF and profile handlers survive.
export function SignIn2({ content }: { content: HTMLElement[] }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (slot.current) for (const node of content) slot.current.append(node);
  }, [content]);
  return (
    <section className="signin-card">
      <header className="signin-heading">
        <span className="signin-brand">MASCAVO <small>FITWEAR</small></span>
        <span className="signin-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M4 12h11m-4-4 4 4-4 4" /></svg>
        </span>
        <p className="dialog-eyebrow">SEU ESPAÇO MASCAVO</p>
        <h2 id="account-title">Bom ter você aqui.</h2>
        <p id="account-description">Entre para cuidar dos seus dados e escolher seu próximo movimento.</p>
      </header>
      <div ref={slot} className="account-content" />
      <footer className="signin-footer"><span aria-hidden="true">◇</span> Feito para acompanhar você.</footer>
    </section>
  );
}
