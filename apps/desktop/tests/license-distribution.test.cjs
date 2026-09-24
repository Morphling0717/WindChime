const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const { bundledInputs, collectDesktopLicenses, generateDesktopLicenses, verifiedInstallerDownload } = require('../scripts/licenses.cjs');

const desktopRoot = path.resolve(__dirname, '..');
const metadata = inputs => ({ inputs: Object.fromEntries(Object.keys(inputs).map(name => [name, {}])), outputs: { 'build/control.js': { inputs: Object.fromEntries(Object.entries(inputs).map(([name, bytesInOutput]) => [name, { bytesInOutput }])) } } });
async function fixture(t, options = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-license-test-'));
  t.after(async () => {
    const target = path.resolve(parent);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith('windchime-license-test-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  const root = path.join(parent, 'apps', 'desktop');
  const dependency = path.join(root, 'node_modules', '@example', 'runtime');
  await fs.mkdir(dependency, { recursive: true });
  await fs.writeFile(path.join(parent, 'package.json'), JSON.stringify({ name: '@windchime/embed', version: '1.2.3', license: 'MIT' }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3', license: 'MIT' }));
  const license = await fs.readFile(path.resolve(desktopRoot, '../../LICENSE'));
  await fs.writeFile(path.join(parent, 'LICENSE'), license);
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: '@example/runtime', version: '2.3.4', license: 'BSD-3-Clause' }));
  if (!options.missingLicense) await fs.writeFile(path.join(dependency, 'LICENSE'), 'Copyright (c) Example\r\nBSD license retained byte for byte\r\n');
  await fs.writeFile(path.join(dependency, 'NOTICE.txt'), 'Additional attribution\r\n');
  await fs.writeFile(path.join(dependency, 'index.js'), '/* Copyright (c) Earlier Author\n * Licensed under BSD-3-Clause. */\nexports.value = 3;\n');
  await fs.writeFile(path.join(root, 'LICENSE'), 'Electron original license');
  await fs.writeFile(path.join(root, 'LICENSES.chromium.html'), '<html>original Chromium notices</html>');
  return { root, dependency, license, metafiles: [metadata({ 'node_modules/@example/runtime/index.js': 20 })] };
}

test('runtime collection excludes build-only and fully tree-shaken dependencies', () => {
  assert.deepEqual(bundledInputs([metadata({ 'src/main.ts': 40, 'node_modules/example/index.js': 20, 'node_modules/tree-shaken/index.js': 0 })]), ['node_modules/example/index.js', 'src/main.ts']);
  assert.throws(() => bundledInputs([]), /requires esbuild/);
  assert.throws(() => bundledInputs([{}]), /Invalid esbuild/);
  assert.throws(() => bundledInputs([{ inputs: {}, outputs: { a: { inputs: { unknown: { bytesInOutput: 1 } } } } }]), /unknown license input/);
});

test('distribution preserves project and dependency bytes, extra attribution and runtime originals', async t => {
  const value = await fixture(t);
  const result = await generateDesktopLicenses(value);
  assert.deepEqual(await fs.readFile(path.join(result.output, 'WindChime-MIT.txt')), value.license);
  const dependency = result.manifest.packages[0];
  assert.equal(dependency.license, 'BSD-3-Clause');
  assert.equal(dependency.name, '@example/runtime');
  assert.equal(dependency.documents.length, 3);
  assert.deepEqual(await fs.readFile(path.join(result.output, 'example__runtime@2.3.4/LICENSE')), await fs.readFile(path.join(value.dependency, 'LICENSE')));
  assert.match(await fs.readFile(path.join(result.output, 'THIRD-PARTY-NOTICES.txt'), 'utf8'), /Earlier Author/);
  assert.match(await fs.readFile(path.join(result.output, 'THIRD-PARTY-NOTICES.txt'), 'utf8'), /Additional attribution/);
  assert.equal(await fs.readFile(path.join(value.root, 'LICENSE'), 'utf8'), 'Electron original license');
  assert.equal(await fs.readFile(path.join(value.root, 'LICENSES.chromium.html'), 'utf8'), '<html>original Chromium notices</html>');
  const json = JSON.stringify(result.manifest);
  assert(!json.includes(value.root));
  assert(!json.includes(os.tmpdir()));
  for (const document of dependency.documents) assert.equal(document.sha256, createHash('sha256').update(await fs.readFile(path.join(result.output, document.path))).digest('hex'));
  assert.deepEqual((await generateDesktopLicenses(value)).manifest, result.manifest);
});

test('a bundled dependency without a license file stops packaging rather than claiming MIT', async t => {
  const value = await fixture(t, { missingLicense: true });
  await assert.rejects(generateDesktopLicenses(value), /no license document/);
});

test('installer source downloads require exact upstream checksums and reuse only a matching cache', async t => {
  const value = await fixture(t);
  const bytes = Buffer.from('Reviewed upstream source archive');
  const asset = { name: 'source.zip', url: 'https://example.test/source.zip', sha256: createHash('sha256').update(bytes).digest('hex') };
  const destination = path.join(value.root, 'build', 'licenses', 'installer', 'sources', asset.name);
  let calls = 0;
  const download = async () => { calls += 1; return new Response(bytes); };
  assert.deepEqual(await verifiedInstallerDownload(asset, destination, download), bytes);
  assert.deepEqual(await verifiedInstallerDownload(asset, destination, download), bytes);
  assert.equal(calls, 1);
  await fs.writeFile(destination, 'corrupted cache');
  await assert.rejects(verifiedInstallerDownload(asset, destination, async () => new Response('unreviewed replacement')), /checksum mismatch/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'corrupted cache');
  await assert.rejects(verifiedInstallerDownload(asset, destination, async () => new Response('not found', { status: 404 })), /404/);
  assert.deepEqual(await verifiedInstallerDownload(asset, destination, download), bytes);
});

test('the production bundle retains all actual JavaScript authors and excludes development dependencies', async () => {
  const result = await build({
    absWorkingDir: desktopRoot, entryPoints: ['src/control.tsx', 'src/display.tsx'], outdir: 'build',
    bundle: true, minify: true, write: false, metafile: true, sourcemap: false,
    platform: 'browser', target: 'chrome148', jsx: 'automatic',
    alias: { react: path.join(desktopRoot, 'node_modules/react'), 'react-dom': path.join(desktopRoot, 'node_modules/react-dom') },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const collected = await collectDesktopLicenses({ root: desktopRoot, metafiles: [result.metafile] });
  assert.deepEqual(collected.packages.map(item => item.name).sort(), ['dijkstrajs', 'qrcode', 'react', 'react-dom', 'scheduler']);
  assert(collected.packages.every(item => item.license === 'MIT'));
  const qr = collected.packages.find(item => item.name === 'qrcode');
  const qrNotices = qr.comments.map(comment => comment.text).join('\n');
  assert.match(qrNotices, /Copyright \(c\) 2011 Ryan Day/);
  assert.match(qrNotices, /Copyright \(c\) 2009 Kazuhiko Arase/);
  assert.match(qrNotices, /DENSO WAVE INCORPORATED/);
  const dijkstra = collected.packages.find(item => item.name === 'dijkstrajs');
  assert.match(dijkstra.comments.map(comment => comment.text).join('\n'), /Wyatt Baldwin/);
  for (const item of collected.packages.filter(item => ['react', 'react-dom', 'scheduler'].includes(item.name))) {
    assert.match(item.documents.map(document => document.bytes.toString('utf8')).join('\n'), /Meta Platforms, Inc\. and affiliates/);
  }
});
