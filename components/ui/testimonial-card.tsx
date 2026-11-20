import { useState } from 'react';
export interface TestimonialAuthor {
  name: string;
  detail?: string;
  avatar?: string;
}
export interface TestimonialCardProps {
  author: TestimonialAuthor;
  text: string;
  rating?: number | null;
}
export function TestimonialCard({ author, text, rating }: TestimonialCardProps) {
  const [broken, setBroken] = useState(false);
  const initials = author.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (
    <figure className="testimonial-card">
      <span className="testimonial-quote-mark" aria-hidden="true">
        “
      </span>
      <blockquote>{text}</blockquote>
      {rating && (
        <span className="testimonial-rating" aria-label={`${rating} de 5 estrelas`}>
          <span aria-hidden="true">
            {'★'.repeat(rating)}
            {'☆'.repeat(5 - rating)}
          </span>
        </span>
      )}
      <figcaption>
        <span className="testimonial-avatar" aria-hidden="true">
          {author.avatar && !broken ? (
            <img src={author.avatar} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            initials
          )}
        </span>
        <span>
          <strong>{author.name}</strong>
          {author.detail && <small>{author.detail}</small>}
        </span>
      </figcaption>
    </figure>
  );
}
