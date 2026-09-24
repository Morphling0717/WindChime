import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcons } from './build-icons.mjs';
import { buildWizardArt } from './build-wizard-art.mjs';
import { generateDesktopLicenses } from './licenses.cjs';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'build'), { recursive: true });
await buildIcons(root);
await buildWizardArt(root);
// One shared parser serves the browser UI and the isolated Node main process.
await build({ absWorkingDir: root, entryPoints: ['../../src/core/connection-key.ts'], outfile: 'build/connection-key.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
const rendererBuild = await build({
  absWorkingDir: root,
  entryPoints: ['src/control.tsx', 'src/display.tsx'],
  outdir: 'build', bundle: true, minify: true, sourcemap: false, metafile: true,
  platform: 'browser', target: 'chrome148', jsx: 'automatic',
  // Every React import, including imports originating in the shared library,
  // resolves to this application's one React installation.
  alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') },
  define: { 'process.env.NODE_ENV': '"production"' },
});
await generateDesktopLicenses({ root, metafiles: [rendererBuild.metafile] });
for (const name of ['control.html', 'display.html']) await copyFile(path.join(root, 'src', name), path.join(root, 'build', name));
