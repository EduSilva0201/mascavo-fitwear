import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
await mkdir('dist/public/assets/rail-ui', {recursive:true});
await build({ entryPoints:['frontend/rail.tsx'], bundle:true, minify:true, format:'esm', target:['es2022'], outfile:'dist/public/assets/rail-ui/rail.js', tsconfig:'tsconfig.frontend.json', define:{'process.env.NODE_ENV':'"production"'} });
const css = spawnSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs','-i','frontend/rail.css','-o','dist/public/assets/rail-ui/rail.css','--minify'], {stdio:'inherit'});
if (css.status !== 0) throw new Error('Rail CSS build failed');
