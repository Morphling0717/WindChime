const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream, openSync, closeSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const artifacts = path.join(root, 'out/releases', version);
const reportPath = path.join(artifacts, 'package-verification.json');
const runtimeFiles = [
  'main.cjs', 'security.cjs', 'workspace.cjs', 'preload-control.cjs', 'preload-display.cjs',
  'build/control.js', 'build/control.css', 'build/control.html',
  'build/display.js', 'build/display.html', 'build/connection-key.cjs',
  'build/icon.ico', 'build/icon.png', 'build/tray.png',
  'build/brand-header.svg', 'build/brand-symbol.svg',
];
const licenseMeta = ['manifest.json', 'installer-manifest.json', 'WindChime-MIT.txt', 'THIRD-PARTY-NOTICES.txt', 'INSTALLER-NOTICES.txt'];
const runtimeDocuments = ['LICENSE', 'LICENSES.chromium.html'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function hashFile(file) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

function safeRelative(value) {
  assert.equal(typeof value, 'string', 'Expected an archive relative path');
  assert(value && !/[\\:\x00-\x1f\x7f]/.test(value), 'Invalid archive relative path');
  assert(value.split('/').every(part => part && part !== '.' && part !== '..'), 'Archive path must stay inside its scope');
  return value;
}

async function resolveSevenZip({ nsis = false } = {}) {
  assert.equal(process.platform, 'win32', 'Package verification requires Windows');
  // A full 7-Zip is needed for NSIS. electron-builder's 7za only supports its
  // smaller format set; detecting this prevents a false installer-format pass.
  const explicit = process.env.WINDCHIME_VERIFY_7ZIP;
  const candidates = explicit ? [path.resolve(explicit)] : [path.resolve(root, '../../.work/tools/7zip/7z.exe')];
  if (!explicit) {
    try { candidates.push(require('7zip-bin').path7za); } catch {}
    candidates.push(await require('app-builder-lib/out/toolsets/7zip').getPath7za());
  }
  for (const file of candidates) {
    try {
      assert((await fs.stat(file)).isFile());
      const formats = execFileSync(file, ['i'], { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (!nsis || /\bNsis\s+nsis\b/i.test(formats)) return file;
      if (explicit) throw new Error('The selected 7-Zip does not support NSIS archives');
    } catch (error) { if (explicit) throw error; }
  }
  throw new Error('Set WINDCHIME_VERIFY_7ZIP to a full 7z.exe with NSIS support; no installer will be executed');
}

function listArchive(sevenZip, archive) {
  const listing = execFileSync(sevenZip, ['l', '-slt', '-sccUTF-8', '--', archive], {
    encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const marker = /\r?\n----------\r?\n/.exec(listing);
  assert(marker, '7-Zip did not report archive entries');
  const header = listing.slice(0, marker.index);
  const records = listing.slice(marker.index + marker[0].length).trim().split(/\r?\n\r?\n/).map(block => {
    const fields = Object.fromEntries(block.split(/\r?\n/).map(line => {
      const separator = line.indexOf(' = '); return separator < 0 ? [] : [line.slice(0, separator), line.slice(separator + 3)];
    }).filter(pair => pair.length));
    const original = fields.Path;
    assert.equal(typeof original, 'string', '7-Zip entry has no path');
    const name = safeRelative(original.replaceAll('\\', '/'));
    assert(!fields['Symbolic Link'] && !fields['Hard Link'] && !/(?:^|\s)l[rwx-]{9}(?:\s|$)/.test(fields.Attributes || ''), 'Archive links are not allowed');
    return { ...fields, name, original, directory: fields.Folder === '+' || /^D/.test(fields.Attributes || '') };
  });
  assert.equal(new Set(records.map(item => item.name.toLowerCase())).size, records.length, 'Archive contains duplicate paths');
  return { header, records };
}

function extractBytes(sevenZip, archive, entry, maxBuffer = 32 * 1024 * 1024) {
  return execFileSync(sevenZip, ['e', '-so', '-bd', '-bb0', '--', archive, entry], {
    windowsHide: true, timeout: 60000, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function verifyLicenseScope(archive) {
  const read = name => Buffer.from(asar.extractFile(archive, path.join('build', 'licenses', ...name.split('/'))));
  const manifest = JSON.parse(read('manifest.json'));
  const installer = JSON.parse(read('installer-manifest.json'));
  const project = require('../../../package.json');
  assert.equal(manifest.schemaVersion, 1); assert.equal(installer.schemaVersion, 1);
  assert.equal(manifest.desktopVersion, version);
  assert.equal(manifest.project.name, project.name); assert.equal(manifest.project.version, project.version);
  assert.equal(manifest.project.license, 'MIT'); assert.equal(manifest.project.document, 'WindChime-MIT.txt');
  assert.deepEqual(manifest.runtimeDocuments, runtimeDocuments);
  const files = new Set(licenseMeta); const directories = new Set(['build/licenses']); const hashes = [];
  const addDocument = (document, predicate) => {
    const name = safeRelative(document.path);
    assert(predicate(name), 'License document escapes its declared component scope');
    assert(!files.has(name), 'Duplicate license document'); files.add(name);
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(read(name)), document.sha256, `License digest differs: ${name}`);
    hashes.push({ name, sha256: document.sha256 });
    let parent = path.posix.dirname(`build/licenses/${name}`);
    while (parent !== 'build') { directories.add(parent); parent = path.posix.dirname(parent); }
  };
  assert.match(manifest.project.sha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(read('WindChime-MIT.txt')), manifest.project.sha256);
  assert(read('WindChime-MIT.txt').equals(await fs.readFile(path.resolve(root, '../../LICENSE'))), 'Project MIT document must remain the repository original');
  hashes.push({ name: 'WindChime-MIT.txt', sha256: manifest.project.sha256 });
  assert(Array.isArray(manifest.packages) && manifest.packages.length > 0);
  const identities = new Set();
  for (const item of manifest.packages) {
    assert.match(item.name, /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i); assert.match(item.version, /^[a-z0-9._+-]+$/i);
    assert.equal(typeof item.license, 'string'); assert(item.license.trim());
    const directory = `${item.name.replace('@', '').replace('/', '__')}@${item.version}`;
    assert(!identities.has(directory), 'Duplicate licensed component'); identities.add(directory);
    assert(Array.isArray(item.bundledSources) && item.bundledSources.length > 0);
    item.bundledSources.forEach(safeRelative);
    assert(Array.isArray(item.documents) && item.documents.length > 0);
    for (const document of item.documents) addDocument(document, name => name.startsWith(`${directory}/`) && name.split('/').length === 2 && /^(?:licen[cs]e|copying|notice|SOURCE-NOTICES)(?:[._-].*)?$/i.test(path.posix.basename(name)));
  }
  assert(Array.isArray(installer.components) && installer.components.length > 0);
  const components = new Map();
  for (const component of installer.components) {
    assert.match(component.name, /^[A-Za-z0-9._-]+$/); assert.match(component.binarySha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof component.license, 'string'); assert(component.license.trim());
    assert(!components.has(component.name.toLowerCase()), 'Duplicate installer component'); components.set(component.name.toLowerCase(), component);
  }
  assert(Array.isArray(installer.documents) && installer.documents.length > 0);
  for (const document of installer.documents) addDocument(document, name => /^installer\/[A-Za-z0-9._-]+\.(?:txt|c)$/.test(name));
  assert(Array.isArray(installer.sources) && installer.sources.length > 0);
  for (const source of installer.sources) {
    assert(components.has(source.component.toLowerCase()), 'Installer source has no declared component');
    assert.equal(new URL(source.url).protocol, 'https:');
    addDocument(source, name => /^installer\/sources\/[A-Za-z0-9._-]+\.(?:zip|tbz2|7z)$/.test(name));
  }
  for (const name of files) {
    const content = read(name);
    assert(content.length > 0, 'License document must not be empty');
    assert(content.equals(await fs.readFile(path.join(root, 'build/licenses', name))), `Packaged license differs from current generated document: ${name}`);
    if (!hashes.some(item => item.name === name)) hashes.push({ name, sha256: sha256(content) });
  }
  return { files: [...files].map(name => `build/licenses/${name}`), directories: [...directories], hashes, components, projectLicense: read('WindChime-MIT.txt') };
}

async function verifyExternalRuntimeLicenses(directory) {
  const electronRoot = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
  const report = [];
  for (const name of runtimeDocuments) {
    const actual = await hashFile(path.join(directory, name));
    assert(actual.bytes > 0, `Missing Electron distribution license: ${name}`);
    assert.deepEqual(actual, await hashFile(path.join(electronRoot, name)), `Distribution ${name} differs from the Electron original`);
    report.push({ name, ...actual });
  }
  return report;
}

async function treeFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = safeRelative(prefix + entry.name);
    assert(!entry.isSymbolicLink(), 'Runtime must not contain filesystem links');
    if (entry.isDirectory()) files.push(...await treeFiles(path.join(directory, entry.name), `${name}/`));
    else { assert(entry.isFile(), 'Runtime must contain only regular files'); files.push(name); }
  }
  return files.sort();
}

async function inspectManagedResources(executable, output) {
  // PEReader reads metadata and raw resource bytes only. In particular, it does
  // not load the setup assembly into a CLR or invoke its entry point/initializer.
  const request = { executable: path.resolve(executable), output: path.resolve(output) };
  await fs.mkdir(request.output);
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = $env:WINDCHIME_VERIFY_RESOURCES_REQUEST | ConvertFrom-Json
$stream = [System.IO.File]::OpenRead($request.executable)
$pe = $null
try {
  $pe = [System.Reflection.PortableExecutable.PEReader]::new($stream)
  if (-not $pe.HasMetadata -or $null -eq $pe.PEHeaders.CorHeader) { throw 'Setup is not a managed PE image' }
  $metadata = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)
  $resourceDirectory = $pe.PEHeaders.CorHeader.ResourcesDirectory
  if ($resourceDirectory.Size -le 0 -or $resourceDirectory.Size -gt 838860800) { throw 'Unexpected managed resource directory size' }
  $block = $pe.GetSectionData($resourceDirectory.RelativeVirtualAddress)
  $results = [System.Collections.Generic.List[object]]::new()
  $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $index = 0
  foreach ($handle in $metadata.ManifestResources) {
    if ($index -ge 32) { throw 'Unexpected managed resource count' }
    $resource = $metadata.GetManifestResource($handle)
    $name = $metadata.GetString($resource.Name)
    if (-not $names.Add($name) -or -not $resource.Implementation.IsNil) { throw 'Duplicate or externally linked managed resource' }
    if ($resource.Offset -lt 0 -or $resource.Offset -gt ($resourceDirectory.Size - 4)) { throw 'Invalid managed resource offset' }
    $reader = $block.GetReader([int]$resource.Offset, [int]($resourceDirectory.Size - $resource.Offset))
    $size = $reader.ReadInt32()
    if ($size -le 0 -or $size -gt $reader.RemainingBytes -or $size -gt 629145600) { throw 'Invalid managed resource length' }
    $bytes = $reader.ReadBytes($size)
    $filename = Join-Path $request.output ('resource-' + $index.ToString('D2') + '.bin')
    $target = [System.IO.File]::Open($filename, [System.IO.FileMode]::CreateNew)
    try { $target.Write($bytes, 0, $bytes.Length) } finally { $target.Dispose() }
    $digest = [System.Security.Cryptography.SHA256]::HashData($bytes)
    $results.Add([pscustomobject]@{name=$name; bytes=$size; sha256=[System.Convert]::ToHexString($digest).ToLowerInvariant(); path=$filename})
    $index++
  }
  if ($results.Count -eq 0) { throw 'Setup has no embedded managed resources' }
  [pscustomobject]@{managedPE=$true; assemblyName=$metadata.GetString($metadata.GetAssemblyDefinition().Name); assemblyVersion=$metadata.GetAssemblyDefinition().Version.ToString(); resources=$results.ToArray()} | ConvertTo-Json -Depth 4 -Compress
} finally {
  if ($null -ne $pe) { $pe.Dispose() } else { $stream.Dispose() }
}
`;
  const result = execFileSync(process.env.WINDCHIME_VERIFY_POWERSHELL || 'pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WINDCHIME_VERIFY_RESOURCES_REQUEST: JSON.stringify(request) },
    windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(result.replace(/^\uFEFF/, '').trim());
}

async function verifyGlassWrapper(setup, stage, packaged, temporary) {
  const managed = await inspectManagedResources(setup, path.join(temporary, 'managed-resources'));
  const prefix = 'WindChime.Install.';
  const resourceNames = ['Engine.exe', 'View.xaml', 'Logo.png', 'Icon.png', 'LICENSE.txt', 'Payload.json'];
  assert.deepEqual(managed.resources.map(item => item.name).sort(), resourceNames.map(name => prefix + name).sort(), 'Glass setup must contain exactly its six approved resources');
  const resources = new Map(managed.resources.map(item => [item.name.slice(prefix.length), item]));
  const references = {
    'Engine.exe': path.join(stage, 'nsis', `WindChime-Engine-${version}.exe`),
    'View.xaml': path.join(root, 'installer/GlassWizard.xaml'),
    'Logo.png': path.resolve(root, '../../assets/branding/windchime_logo/02_Lockups/WindChime_stacked_glass_light.png'),
    'Icon.png': path.join(root, 'build/icon.png'),
    'LICENSE.txt': path.resolve(root, '../../LICENSE'),
  };
  for (const [name, reference] of Object.entries(references)) {
    const actual = resources.get(name), expected = await hashFile(reference);
    assert.equal(actual.sha256, expected.sha256, `Glass setup contains different ${name} bytes`);
    assert.equal(actual.bytes, expected.bytes, `Glass setup contains a different ${name} size`);
  }
  const manifest = JSON.parse((await fs.readFile(resources.get('Payload.json').path, 'utf8')).replace(/^\uFEFF/, ''));
  assert.deepEqual(Object.keys(manifest).sort(), ['appId', 'engineSha256', 'files', 'version']);
  assert.equal(manifest.version, version); assert.equal(manifest.appId, 'org.windchime.desktop');
  assert.equal(manifest.engineSha256, resources.get('Engine.exe').sha256);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0);
  const stageFiles = await treeFiles(packaged);
  assert.deepEqual(manifest.files.map(item => safeRelative(item.path)).sort(), stageFiles, 'Glass setup verification manifest does not describe the complete packaged runtime');
  for (const file of manifest.files) {
    assert.deepEqual(Object.keys(file).sort(), ['bytes', 'path', 'sha256']);
    assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0); assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual({ bytes: file.bytes, sha256: file.sha256 }, await hashFile(path.join(packaged, file.path)), `Glass setup runtime manifest differs: ${file.path}`);
  }
  return { managed, engine: resources.get('Engine.exe').path, manifestFiles: stageFiles.length };
}

async function verifyPackage(stageArgument) {
  assert.equal(typeof stageArgument, 'string', 'Usage: node scripts/verify-package.cjs <stage path printed by npm run make>');
  const stage = path.resolve(stageArgument);
  assert.match(path.basename(stage), /^windchime-make-[A-Za-z0-9_-]+$/, 'Expected the make staging directory');
  const packaged = path.join(stage, 'WindChime-win32-x64');
  const archive = path.join(packaged, 'resources/app.asar');
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const archivePackage = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(archivePackage.version, version); assert.equal(archivePackage.license, 'MIT');
  const licenses = await verifyLicenseScope(archive);
  const allowedFiles = ['package.json', ...runtimeFiles, ...licenses.files];
  const directories = new Set(['build', ...licenses.directories]);
  const allowedEntries = new Set([...directories, ...allowedFiles]);
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, ''));
  assert.equal(new Set(entries).size, entries.length, 'Archive contains duplicate entries');
  assert.equal(entries.length, allowedEntries.size, 'Archive does not contain exactly the approved runtime and licensed notices');
  for (const entry of entries) {
    assert(allowedEntries.has(entry), `Archive contains an unapproved file: ${entry}`);
    const metadata = asar.statFile(archive, entry.split('/').join(path.sep), false);
    assert(!metadata.link && !metadata.unpacked, `Archive must not reference an external file: ${entry}`);
    assert.equal(Boolean(metadata.files), directories.has(entry), `Unexpected archive entry type: ${entry}`);
  }
  // Fixed runtime paths plus strictly scoped manifest documents exclude secrets,
  // databases, source maps, gateway sources, build tools and license-audit scratch.
  for (const entry of allowedFiles) {
    const content = Buffer.from(asar.extractFile(archive, entry.split('/').join(path.sep)));
    if (entry !== 'package.json') assert(content.equals(await fs.readFile(path.join(root, entry))), `Packaged ${entry} differs from the current build`);
    if (/\.(?:c?js|html|css|json|txt)$/.test(entry)) {
      assert(!/\bwc_(?:ctl|disp)_[A-Za-z0-9_-]{43}\b|\bwc_conn_v1\.[A-Za-z0-9_-]{80,}\b|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content.toString('utf8')), `Recognizable credential material found in ${entry}; contents withheld`);
    }
  }
  const runtimeLicenseHashes = await verifyExternalRuntimeLicenses(packaged);
  const setupName = `WindChime-Setup-${version}.exe`, zipName = `WindChime-win32-x64-${version}.zip`;
  const manifest = new Map();
  for (const line of (await fs.readFile(path.join(artifacts, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)) {
    const match = /^([A-Fa-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    assert(match, 'SHA256SUMS.txt must use standard sha256sum format');
    assert(!manifest.has(match[2]), 'Duplicate checksum artifact'); manifest.set(match[2], match[1].toLowerCase());
  }
  assert.deepEqual([...manifest.keys()].sort(), [setupName, zipName].sort(), 'Checksum manifest must describe exactly the NSIS and portable release');
  const hashes = [];
  for (const name of [setupName, zipName]) {
    const actual = await hashFile(path.join(artifacts, name));
    assert.equal(actual.sha256, manifest.get(name), `${name} hash differs from SHA256SUMS.txt`); hashes.push({ name, ...actual });
  }
  const sevenZip = await resolveSevenZip({ nsis: true });
  const setup = path.join(artifacts, setupName);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `windchime-package-verification-${version}-`));
  const glass = await verifyGlassWrapper(setup, stage, packaged, temporary);
  const engine = glass.engine;
  const outer = listArchive(sevenZip, engine);
  assert(/^Type = Nsis\r?$/m.test(outer.header), 'Embedded engine must be a readable NSIS archive');
  const payloads = outer.records.filter(item => /(?:^|\/)app-64\.7z$/.test(item.name));
  assert.equal(payloads.length, 1, 'Expected exactly one x64 runtime payload');
  const payload = path.join(temporary, 'app-64.7z');
  const descriptor = openSync(payload, 'wx');
  try {
    // The embedded engine is archive DATA. Neither installer is ever executed.
    execFileSync(sevenZip, ['e', '-so', '-bd', '-bb0', '--', engine, payloads[0].original], { windowsHide: true, timeout: 60000, stdio: ['ignore', descriptor, 'pipe'] });
  } finally { closeSync(descriptor); }
  const payloadEntries = listArchive(sevenZip, payload);
  const stageFiles = await treeFiles(packaged);
  assert.deepEqual(payloadEntries.records.filter(item => !item.directory).map(item => item.name).sort(), stageFiles, 'NSIS runtime payload file list differs from the packaged runtime');
  const payloadRoot = path.join(temporary, 'runtime'); await fs.mkdir(payloadRoot);
  // Every path was validated against the known package before isolated extraction.
  execFileSync(sevenZip, ['x', '-y', '-bd', '-bb0', `-o${payloadRoot}`, '--', payload], { windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const name of stageFiles) assert.deepEqual(await hashFile(path.join(payloadRoot, name)), await hashFile(path.join(packaged, name)), `NSIS payload content differs: ${name}`);
  const zip = path.join(artifacts, zipName), portable = listArchive(sevenZip, zip);
  assert.deepEqual(portable.records.filter(item => !item.directory).map(item => item.name).sort(), stageFiles, 'Portable file list differs from NSIS runtime');
  for (const name of ['resources/app.asar', 'WindChime.exe', ...runtimeDocuments]) {
    const bytes = extractBytes(sevenZip, zip, portable.records.find(item => item.name === name).original, 384 * 1024 * 1024);
    assert.equal(sha256(bytes), (await hashFile(path.join(packaged, name))).sha256, `Portable runtime differs: ${name}`);
  }
  // The MIT license is checked inside the installed ASAR, not merely in source
  // configuration. Inspect embedded plugin bytes against their attribution scope.
  const embeddedComponents = [];
  for (const record of outer.records.filter(item => /\.dll$/i.test(item.name))) {
    const component = licenses.components.get(path.posix.basename(record.name, path.posix.extname(record.name)).toLowerCase());
    if (!component) continue;
    const bytes = extractBytes(sevenZip, engine, record.original, 4 * 1024 * 1024);
    assert.equal(sha256(bytes), component.binarySha256, `Embedded installer component differs from its notice manifest: ${component.name}`);
    embeddedComponents.push({ name: component.name, entry: record.name, sha256: component.binarySha256 });
  }
  assert(embeddedComponents.length > 0, 'No declared NSIS plugin could be verified');
  return {
    date: new Date().toISOString(), version, passed: true, archive, entryCount: entries.length,
    runtimeAllowlist: true, noCredentialLiterals: true, matchedFiles: allowedFiles,
    licenses: { manifestScoped: true, projectMIT: true, documentHashes: licenses.hashes, electronOriginals: runtimeLicenseHashes, embeddedComponents },
    installer: { format: 'WPF managed PE with embedded Nsis engine', managedPE: glass.managed, manifestFilesMatched: glass.manifestFiles, runtimePayload: payloads[0].name, payloadFilesMatched: stageFiles.length, temporary, sevenZip },
    checksumManifest: 'SHA256SUMS.txt', hashes, portableRuntimeMatches: true, executedInstaller: false,
  };
}

if (require.main === module) {
  (async () => {
    assert.equal(process.argv.length, 3, 'Usage: node scripts/verify-package.cjs <stage path printed by npm run make>');
    const report = await verifyPackage(process.argv[2]);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  })().catch(async error => {
    const report = { date: new Date().toISOString(), passed: false, error: error.message, executedInstaller: false };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n').catch(() => {}); console.error(report.error); process.exitCode = 1;
  });
}

module.exports = { verifyPackage, resolveSevenZip, verifyExternalRuntimeLicenses, inspectManagedResources };
