import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcons } from './build-icons.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'build'), { recursive: true });
await buildIcons(root);
await build({
  absWorkingDir: root,
  entryPoints: ['src/control.tsx', 'src/display.tsx'],
  outdir: 'build', bundle: true, minify: true, sourcemap: false,
  platform: 'browser', target: 'chrome148', jsx: 'automatic',
  // Every React import, including imports originating in the shared library,
  // resolves to this application's one React installation.
  alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') },
  define: { 'process.env.NODE_ENV': '"production"' },
});
for (const name of ['control.html', 'display.html']) await copyFile(path.join(root, 'src', name), path.join(root, 'build', name));
