const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const noticeFile = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const noticeComment = /copyright|@license|licensed under|SPDX-License-Identifier/i;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = value => value.split(path.sep).join('/');

function packageRoot(input, root) {
  const filename = path.resolve(root, input);
  const segments = filename.split(path.sep);
  const index = segments.lastIndexOf('node_modules');
  if (index < 0) return null;
  const count = segments[index + 1]?.startsWith('@') ? 3 : 2;
  if (segments.length <= index + count) throw new Error(`Invalid bundled dependency input: ${input}`);
  return { directory: segments.slice(0, index + count).join(path.sep), filename };
}

// Only include inputs which contributed bytes to a final bundle. Build tools,
// optional Node-only QR exporters and tree-shaken files are not runtime imports.
function bundledInputs(metafiles) {
  if (!Array.isArray(metafiles) || !metafiles.length) throw new Error('License collection requires esbuild metafiles.');
  const inputs = new Set();
  for (const metafile of metafiles) {
    if (!metafile?.inputs || !metafile?.outputs) throw new Error('Invalid esbuild license metadata.');
    for (const output of Object.values(metafile.outputs)) {
      for (const [filename, value] of Object.entries(output.inputs || {})) {
        if (value.bytesInOutput > 0) {
          if (!Object.hasOwn(metafile.inputs, filename)) throw new Error('Output refers to an unknown license input.');
          inputs.add(filename);
        }
      }
    }
  }
  return [...inputs].sort();
}

async function readDocuments(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const names = entries.filter(entry => entry.isFile() && noticeFile.test(entry.name)).map(entry => entry.name).sort();
  if (!names.some(name => /^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(name))) {
    throw new Error(`Bundled package has no license document: ${path.basename(directory)}`);
  }
  return Promise.all(names.map(async name => {
    const bytes = await fs.readFile(path.join(directory, name));
    if (!bytes.toString('utf8').trim()) throw new Error(`Empty license document: ${name}`);
    return { name, bytes, sha256: digest(bytes) };
  }));
}

async function collectDesktopLicenses({ root, metafiles }) {
  root = path.resolve(root);
  const project = JSON.parse(await fs.readFile(path.resolve(root, '../../package.json'), 'utf8'));
  const desktop = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (project.license !== 'MIT' || desktop.license !== 'MIT') throw new Error('Project license metadata changed; review desktop notices.');
  const projectLicense = await fs.readFile(path.resolve(root, '../../LICENSE'));
  if (!projectLicense.toString('utf8').includes('Permission is hereby granted, free of charge')) throw new Error('Project MIT license document is missing.');
  const packages = new Map();
  for (const input of bundledInputs(metafiles)) {
    const resolved = packageRoot(input, root);
    if (!resolved) continue;
    let item = packages.get(resolved.directory);
    if (!item) {
      const metadata = JSON.parse(await fs.readFile(path.join(resolved.directory, 'package.json'), 'utf8'));
      if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(metadata.name) || !/^[a-z0-9._+-]+$/i.test(metadata.version)) {
        throw new Error('Invalid bundled package name or version.');
      }
      if (typeof metadata.license !== 'string' || !metadata.license.trim()) throw new Error(`Missing license identifier: ${metadata.name}`);
      item = {
        name: metadata.name, version: metadata.version, license: metadata.license,
        directoryName: `${metadata.name.replace('@', '').replace('/', '__')}@${metadata.version}`,
        documents: await readDocuments(resolved.directory), sources: [], comments: [],
      };
      packages.set(resolved.directory, item);
    }
    const sourceName = posix(path.relative(resolved.directory, resolved.filename));
    item.sources.push(sourceName);
    // QRCode embeds earlier authors' notices in source instead of its LICENSE.
    // Retain upstream comment text verbatim, including its trademark statement.
    const source = await fs.readFile(resolved.filename, 'utf8');
    for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (noticeComment.test(match[0])) item.comments.push({ source: sourceName, text: match[0] });
    }
  }
  const result = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  const identities = new Set();
  for (const item of result) {
    if (identities.has(item.directoryName)) throw new Error(`Duplicate package installation needs license review: ${item.name}@${item.version}`);
    identities.add(item.directoryName);
  }
  return { projectName: project.name, projectVersion: project.version, desktopVersion: desktop.version, projectLicense, packages: result };
}

async function generateDesktopLicenses(options) {
  const root = path.resolve(options.root);
  const result = await collectDesktopLicenses({ ...options, root });
  // A fixed generated directory prevents callers from overwriting Electron's
  // root LICENSE or LICENSES.chromium.html, which remain separate distribution files.
  const output = path.join(root, 'build', 'licenses');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'WindChime-MIT.txt'), result.projectLicense);
  const sections = [
    'WindChime desktop — third-party notices',
    'The WindChime project uses the MIT license; see WindChime-MIT.txt.',
    'Third-party components keep their own copyright and license terms.',
    'Electron: see LICENSE beside WindChime.exe.',
    'Chromium and its bundled components: see LICENSES.chromium.html beside WindChime.exe.',
    'Those original runtime documents must accompany both installed and portable distributions.',
    '',
  ];
  const manifest = { schemaVersion: 1, project: { name: result.projectName, version: result.projectVersion, license: 'MIT', document: 'WindChime-MIT.txt', sha256: digest(result.projectLicense) }, desktopVersion: result.desktopVersion, packages: [], runtimeDocuments: ['LICENSE', 'LICENSES.chromium.html'] };
  for (const item of result.packages) {
    const directory = path.join(output, item.directoryName);
    await fs.mkdir(directory, { recursive: true });
    sections.push('='.repeat(72), `${item.name} ${item.version} (${item.license})`, '');
    const documents = [];
    for (const document of item.documents) {
      await fs.writeFile(path.join(directory, document.name), document.bytes);
      documents.push({ path: `${item.directoryName}/${document.name}`, sha256: document.sha256 });
      sections.push(`--- ${document.name} ---`, document.bytes.toString('utf8'), '');
    }
    if (item.comments.length) {
      const text = item.comments.map(comment => `--- ${comment.source} ---\n${comment.text}\n`).join('\n');
      await fs.writeFile(path.join(directory, 'SOURCE-NOTICES.txt'), text);
      documents.push({ path: `${item.directoryName}/SOURCE-NOTICES.txt`, sha256: digest(text) });
      sections.push('--- Notices from bundled source files (verbatim) ---', text);
    }
    manifest.packages.push({ name: item.name, version: item.version, license: item.license, bundledSources: item.sources, documents });
  }
  await fs.writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), sections.join('\n') + '\n');
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, manifest };
}

// These are the upstream archives corresponding to the unchanged DLLs in
// electron-builder's nsis-resources 3.4.1. Source archives are also distributed,
// not merely linked, so users can inspect/rebuild the LGPL components offline.
const installerAssets = [
  { name: 'StdUtils.2018-10-27.zip', component: 'StdUtils', url: 'https://github.com/lordmulder/stdutils/releases/download/1.14/StdUtils.2018-10-27.zip', sha256: '3ffe893dc7477fdb1cac551a86ae017509e1f2d0ebdc7185fd0fbaf20870688c' },
  { name: 'StdUtils.2018-10-27.sources.tbz2', component: 'StdUtils', url: 'https://github.com/lordmulder/stdutils/releases/download/1.14/StdUtils.2018-10-27.sources.tbz2', sha256: 'c5e3b1a66219bc9564c2ccc1702691327eecf044ad33404ac268d725d22dca49' },
  { name: 'Nsis7z_19.00.7z', component: 'nsis7z', url: 'https://nsis.sourceforge.io/mediawiki/images/6/69/Nsis7z_19.00.7z', sha256: '6f2f3730049926f40442ee0c8b7d3e3dee7ace544d82467ff8059ea3f4201c58' },
  { name: 'lzma1900.7z', component: 'nsis7z', url: 'https://www.7-zip.org/a/lzma1900.7z', sha256: '00f569e624b3d9ed89cf8d40136662c4c5207eaceb92a70b1044c77f84234bad' },
  { name: 'UAC.zip', component: 'UAC', url: 'https://nsis.sourceforge.io/mediawiki/images/8/8f/UAC.zip', sha256: '20e3192af5598568887c16d88de59a52c2ce4a26e42c5fb8bee8105dcbbd1760' },
  { name: 'NsProcess.zip', component: 'nsProcess', url: 'https://nsis.sourceforge.io/mediawiki/images/1/18/NsProcess.zip', sha256: 'fc19fc66a5219a233570fafd5daeb0c9b85387b379f6df5ac8898159a57c5944' },
  { name: 'WinShell.zip', component: 'WinShell', url: 'https://nsis.sourceforge.io/mediawiki/images/5/54/WinShell.zip', sha256: '34e111f8aacf64c540d848fd06b9d6f3e2c10cb825ec9329a01d1141973e749b' },
];
const installerComponents = {
  StdUtils: { license: 'LGPL-2.1-or-later with upstream clarification', archive: 'StdUtils.2018-10-27.zip', binary: 'Plugins/Unicode/StdUtils.dll', sha256: 'b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e', documents: ['LGPL.txt', 'LGPL_CLARIFICATION.txt', 'ReadMe.txt'], source: 'https://github.com/lordmulder/stdutils/releases/tag/1.14' },
  nsis7z: { license: 'Upstream LGPL statement; LZMA SDK public domain', archive: 'Nsis7z_19.00.7z', binary: 'Plugins/x86-unicode/nsis7z.dll', sha256: 'b393f05e8ff919ef071181050e1873c9a776e1a0ae8329aefff7007d0cadf592', documents: ['Contrib/nsis7z/DOC/License.txt', 'Contrib/nsis7z/DOC/nsis7z.txt'], source: 'https://nsis.sourceforge.io/Nsis7z_plug-in' },
  UAC: { license: 'Zlib', archive: 'UAC.zip', binary: 'Plugins/x86-unicode/UAC.dll', sha256: '2f7f8fc05dc4fd0d5cda501b47e4433357e887bbfed7292c028d99c73b52dc08', documents: ['License.txt', 'History.txt'], source: 'https://nsis.sourceforge.io/UAC_plug-in' },
  nsProcess: { license: 'Upstream attribution provided; no SPDX identifier or standalone license in the archive', archive: 'NsProcess.zip', binary: 'Plugin/nsProcessW.dll', sha256: '30c6c3dd3cc7fcea6e6081ce821adc7b2888542dae30bf00e881c0a105eb4d11', documents: ['Readme.txt', 'Source/nsProcess.c'], source: 'https://nsis.sourceforge.io/NsProcess_plugin' },
  WinShell: { license: 'Freeware (upstream plugin page); no standalone license file in the archive', archive: 'WinShell.zip', binary: 'Plugins/x86-unicode/WinShell.dll', sha256: '9be85b986ea66a6997dde658abe82b3147ed2a1a3dcb784bb5176f41d22815a6', documents: [], source: 'https://nsis.sourceforge.io/WinShell_plug-in' },
};

async function verifiedInstallerDownload(asset, destination, fetcher = fetch) {
  let bytes;
  try { bytes = await fs.readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (bytes && digest(bytes) === asset.sha256) return bytes;
  const response = await fetcher(asset.url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not download installer license source: ${asset.name} (${response.status})`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== asset.sha256) throw new Error(`Installer license source checksum mismatch: ${asset.name}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return bytes;
}

async function generateInstallerLicenses({ root, pluginNames = Object.keys(installerComponents) }) {
  root = path.resolve(root);
  const { createRequire } = require('node:module');
  const { promisify } = require('node:util');
  const execFile = promisify(require('node:child_process').execFile);
  const desktopRequire = createRequire(path.join(root, 'package.json'));
  const toolsets = desktopRequire('app-builder-lib/out/toolsets/windows');
  const [nsis, pluginDirectory, sevenZip] = await Promise.all([toolsets.getMakeNsisPath(), toolsets.getNsisPluginsPath(), desktopRequire('app-builder-lib/out/toolsets/7zip').getPath7za()]);
  const nsisCopying = await fs.readFile(path.join(nsis.env?.NSISDIR || path.dirname(nsis.path), 'COPYING'));
  if (digest(nsisCopying) !== '3c8de989f6504d52f5f8dfafedb6668cd47201f5d01f1319570727c091425dd6') throw new Error('NSIS license changed; review installer notices before release.');
  const names = [...new Set(pluginNames)].sort();
  for (const name of names) if (!installerComponents[name]) throw new Error(`Unreviewed NSIS resource plugin: ${name}`);
  const output = path.join(root, 'build', 'licenses');
  const directory = path.join(output, 'installer');
  await fs.mkdir(directory, { recursive: true });
  const manifest = { schemaVersion: 1, nsis: '3.0.4.1', resources: '3.4.1', components: [], sources: [], documents: [] };
  const notices = [
    'WindChime installer — third-party notices',
    'The WindChime application uses MIT. The installer components below retain their own terms.',
    'No upstream DLL has been modified. The compiler packages are nsis 3.0.4.1 and nsis-resources 3.4.1.',
    'NSIS core and standard plugins: zlib/libpng; compression modules have their separately stated terms.',
    'NSIS-COPYING.txt includes the complete upstream terms and the LZMA linking exception.',
    'Upstream source and builder patches: https://github.com/electron-userland/electron-builder-binaries/tree/nsis-3.0.4.1',
    'StdUtils and nsis7z source archives are included in installer/sources. See their readme files for rebuilding.',
    'For nsis7z 19.00, overlay the C/CPP folders from lzma1900.7z into Contrib/nsis7z from Nsis7z_19.00.7z, then build the upstream VS 2017 solution.',
    'No additional restriction on modifying these libraries or reverse engineering them for debugging modifications is imposed by WindChime.',
    '',
  ];
  async function document(name, bytes) {
    await fs.writeFile(path.join(directory, name), bytes);
    manifest.documents.push({ path: `installer/${name}`, sha256: digest(bytes) });
    notices.push('='.repeat(72), name, '', bytes.toString('utf8'), '');
  }
  await document('NSIS-COPYING.txt', nsisCopying);
  const builderLicense = await fs.readFile(path.join(path.dirname(desktopRequire.resolve('electron-builder/package.json')), 'LICENSE'));
  await document('electron-builder-LICENSE.txt', builderLicense);
  for (const asset of installerAssets.filter(asset => names.includes(asset.component))) {
    await verifiedInstallerDownload(asset, path.join(directory, 'sources', asset.name));
    manifest.sources.push({ component: asset.component, path: `installer/sources/${asset.name}`, url: asset.url, sha256: asset.sha256 });
  }
  for (const name of names) {
    const component = installerComponents[name];
    const archive = path.join(directory, 'sources', component.archive);
    const installedDll = await fs.readFile(path.join(pluginDirectory, 'x86-unicode', `${name}.dll`));
    const extract = async member => (await execFile(sevenZip, ['e', '-so', archive, member], { encoding: 'buffer', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout;
    const originalDll = await extract(component.binary);
    if (digest(installedDll) !== component.sha256 || !originalDll.equals(installedDll)) throw new Error(`NSIS plugin no longer matches reviewed upstream binary: ${name}`);
    manifest.components.push({ name, license: component.license, binarySha256: component.sha256, upstream: component.source });
    notices.push(`${name}: ${component.license}`, `Upstream: ${component.source}`, '');
    if (name === 'WinShell') {
      await document('WinShell-NOTICE.txt', Buffer.from('WinShell plug-in\nAuthor: Anders\nLicense: Freeware (as labeled on the upstream NSIS plugin page).\nSource: https://nsis.sourceforge.io/WinShell_plug-in\nThe upstream distribution contains DLLs only and no separate license text. Its original archive accompanies this notice. This component is not labeled MIT by WindChime.\n'));
    }
    for (const filename of component.documents) await document(`${name}-${path.basename(filename)}`, await extract(filename));
  }
  await fs.writeFile(path.join(output, 'INSTALLER-NOTICES.txt'), notices.join('\n') + '\n');
  await fs.writeFile(path.join(output, 'installer-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, manifest };
}

module.exports = { bundledInputs, collectDesktopLicenses, generateDesktopLicenses, generateInstallerLicenses, verifiedInstallerDownload };
