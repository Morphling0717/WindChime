import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await build({entryPoints:[resolve(root,'display/index.tsx')],outfile:resolve(root,'public/display.js'),bundle:true,minify:true,platform:'browser',target:['chrome110'],format:'esm',jsx:'automatic',legalComments:'none',define:{'process.env.NODE_ENV':'"production"'},alias:{react:dirname(require.resolve('react/package.json')),'react-dom':dirname(require.resolve('react-dom/package.json'))}});
console.log('Built standalone display bundle (display APIs only, no Next.js layout).');
