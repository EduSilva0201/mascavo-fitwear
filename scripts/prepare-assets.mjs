import { mkdir, copyFile } from 'node:fs/promises';
// Explicit allowlist: never publish the repository root or server sources.
await mkdir('dist/public', { recursive: true });
for (const name of ['index.html', 'styles.css', 'script.js', 'account.js', 'hero.css', 'hero.js', 'ui.css', 'ui.js']) {
  await copyFile(name, `dist/public/${name}`);
}
await mkdir('dist/public/assets/hero', { recursive: true });
for (const name of [
  'macaquinho-marrom',
  'conjunto-preto',
  'conjunto-vinho',
  'detalhe-marrom',
  'costas-preto',
  'costas-vinho',
]) {
  await copyFile(`assets/hero/${name}.webp`, `dist/public/assets/hero/${name}.webp`);
}

await mkdir("dist/public/assets/campaign", { recursive: true });
for (const name of ["movimento-logo.jpg", "essencia-logo.jpg"]) await copyFile(`assets/campaign/${name}`, `dist/public/assets/campaign/${name}`);

await mkdir("dist/public/assets/products/sofi", { recursive: true });
for (const name of ["preto.png", "vinho.png"]) await copyFile(`assets/products/sofi/${name}`, `dist/public/assets/products/sofi/${name}`);

await mkdir("dist/public/assets/products/fluid", { recursive: true });
for (const name of ["frente.png", "costas.jpeg", "detalhe.jpeg"]) await copyFile(`assets/products/fluid/${name}`, `dist/public/assets/products/fluid/${name}`);

await mkdir("dist/public/assets/products/race", { recursive: true });
for (const name of ["preto-frente.png", "azul-petroleo-frente.png", "azul-petroleo-costas.jpeg"]) await copyFile(`assets/products/race/${name}`, `dist/public/assets/products/race/${name}`);

await mkdir("dist/public/assets/products/fusion", { recursive: true });
for (const name of ["preto-frente.png", "preto-costas.jpeg", "rosa-bebe-frente.png", "rosa-bebe-costas.png"]) await copyFile(`assets/products/fusion/${name}`, `dist/public/assets/products/fusion/${name}`);

await mkdir("dist/public/assets/products/ibiza", { recursive: true });
for (const name of ["azul-petroleo-frente.png", "azul-petroleo-costas.png"]) await copyFile(`assets/products/ibiza/${name}`, `dist/public/assets/products/ibiza/${name}`);

await mkdir("dist/public/assets/products/duo", { recursive: true });
for (const name of ["vinho-frente.png", "vinho-costas.jpeg", "preto-frente.png", "preto-costas.png", "preto-detalhe.png"]) await copyFile(`assets/products/duo/${name}`, `dist/public/assets/products/duo/${name}`);

await mkdir("dist/public/assets/categories", { recursive: true });
for (const name of ["leggings.jpg", "tops.jpg"]) await copyFile(`assets/categories/${name}`, `dist/public/assets/categories/${name}`);

await mkdir("dist/public/assets/brand", { recursive: true });
await copyFile("assets/brand/mascavo-logo.png", "dist/public/assets/brand/mascavo-logo.png");

await mkdir("dist/public/assets/rail", {recursive:true});
for (const name of ["fluid-front.webp","fluid-back.webp","fluid-side.webp","mix-preto-front.webp","mix-preto-back.webp","mix-preto-side.webp","mix-rosa-front.webp","mix-rosa-back.webp","mix-rosa-side.webp"]) await copyFile(`assets/rail/${name}`, `dist/public/assets/rail/${name}`);
await import("./build-rail.mjs");
