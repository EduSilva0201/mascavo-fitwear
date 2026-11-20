import { useEffect, useState } from 'react';
import { TestimonialCard, type TestimonialCardProps } from './testimonial-card';
type Entry = TestimonialCardProps & { id: string };
export function TestimonialsSection({ testimonials }: { testimonials: Entry[] }) {
  const [paused, setPaused] = useState(false),
    animated = testimonials.length > 1;
  const [viewport, setViewport] = useState(
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const repeats = animated
    ? Math.max(1, Math.ceil((Math.ceil(viewport / 350) + 1) / testimonials.length))
    : 1;
  const entries = Array.from({ length: repeats }, (_, copy) =>
    testimonials.map((item) => ({ item, copy })),
  ).flat();
  return (
    <section className="editorial-section testimonial-section" aria-labelledby="testimonials-title">
      <header className="editorial-heading">
        <span className="editorial-eyebrow">MASCAVO / HISTÓRIAS EM MOVIMENTO</span>
        <h2 id="testimonials-title">
          Quem veste, <em>conta.</em>
        </h2>
        <p>Experiências que fazem parte da nossa história.</p>
      </header>
      {testimonials.length ? (
        <>
          {animated && (
            <button
              type="button"
              className="testimonial-pause"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? 'Retomar movimento' : 'Pausar movimento'}{' '}
              <span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span>
            </button>
          )}
          <div
            className={`testimonials-window ${animated ? 'has-marquee' : ''} ${paused ? 'is-paused' : ''}`}
          >
            <div className="testimonials-track">
              <ul className="testimonials-group" aria-label="Depoimentos">
                {entries.map(({ item, copy }) => (
                  <li
                    key={`${copy}-${item.id}`}
                    className={copy ? 'testimonial-repeated' : undefined}
                    aria-hidden={copy ? true : undefined}
                    inert={copy ? true : undefined}
                  >
                    <TestimonialCard {...item} />
                  </li>
                ))}
              </ul>
              {animated && (
                <ul className="testimonials-group testimonials-copy" aria-hidden="true" inert>
                  {entries.map(({ item, copy }) => (
                    <li key={`${copy}-${item.id}`}>
                      <TestimonialCard {...item} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="testimonial-empty">
          <span aria-hidden="true">◇</span>
          <p>
            As primeiras histórias da Mascavo estão por vir.
            <br />
            Vai ser especial ter a sua por aqui.
          </p>
        </div>
      )}
      <a className="editorial-link" href="/duvidas-frequentes">
        Ficou com alguma dúvida? <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}
