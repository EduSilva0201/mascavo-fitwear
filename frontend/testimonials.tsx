import { createRoot } from 'react-dom/client';
import { TestimonialsSection } from '../components/ui/testimonials-with-marquee';
const host = document.getElementById('testimonials-root');
if (host) {
  fetch('/api/v1/content')
    .then(async (response) => {
      if (!response.ok) throw new Error('Content unavailable');
      const { testimonials } = await response.json();
      if (!Array.isArray(testimonials)) throw new Error('Invalid testimonials');
      createRoot(host).render(
        <TestimonialsSection
          testimonials={testimonials.map((item) => ({
            id: item.id,
            author: { name: item.author_name, detail: item.author_detail, avatar: item.avatar_url },
            text: item.quote,
            rating: item.rating,
          }))}
        />,
      );
    })
    .catch(() => {
      const feedback = host.querySelector('[role="status"]');
      if (feedback) feedback.textContent = 'As histórias da Mascavo estarão disponíveis em breve.';
    });
}
