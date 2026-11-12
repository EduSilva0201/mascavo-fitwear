import { createRoot } from 'react-dom/client';
import ClothingRailHero, { type RailGarment } from '@/components/ui/product-rail-gallery';

// Mix is a visual reference, not a catalog record. Do not link these views
// to Fusion, Duo or another product with different garment construction.
const items: RailGarment[] = [
 { id: 'mix-preto', name: 'Mix · Preto', color: '#17171b',
   description: 'Macaquinho de alças largas, cintura marcada e shorts solto com barra curva.',
   image: 'assets/rail/mix-preto-front.webp', backImage: 'assets/rail/mix-preto-back.webp', sideImage: 'assets/rail/mix-preto-side.webp',
   details: ['Peça única', 'Costas fechadas'],
 },
 { id: 'mix-rosa', name: 'Mix · Rosa', color: '#f590b4',
   description: 'O mesmo desenho em rosa: corpo contínuo, cintura larga e shorts franzido.',
   image: 'assets/rail/mix-rosa-front.webp', backImage: 'assets/rail/mix-rosa-back.webp', sideImage: 'assets/rail/mix-rosa-side.webp',
   details: ['Peça única', 'Costas fechadas'],
 },
 { id: "fluid-chocolate", name: "Macaquinho Fluid · Chocolate", color: "#4b2920", thinStraps: true,
   description: "Alças finas reguláveis, short sobreposto e bolso lateral no short interno.",
   image: "assets/rail/fluid-front.webp", backImage: "assets/rail/fluid-back.webp", sideImage: "assets/rail/fluid-side.webp",
   details: ["Chocolate", "Tamanhos M e G", "Bolso lateral"],
 },
];
function RailShowcase() {
 return <ClothingRailHero className="mascavo-rail" items={items} hanger="matte" autoplay={false}
   eyebrow="MASCAVO / EM MOVIMENTO" heading="Um novo olhar para cada peça."
   caption="Passe o mouse para virar. Arraste ou clique para ver de perto."
   labels={{front:'Frente',back:'Costas',close:'Fechar',show:'Mostrar'}}
   action={<a className="rail-collection-link" href="#produtos">Explorar a coleção <span aria-hidden="true">↗</span></a>}
 />;
}
const host = document.querySelector('#clothing-rail-root');
if (host) createRoot(host).render(<RailShowcase />);
