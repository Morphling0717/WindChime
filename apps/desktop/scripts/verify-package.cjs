const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { convertVersion } = require('electron-winstaller');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'out/installers');
const reportPath = path.join(artifacts, 'package-verification.json');
const runtimeFiles = [
  'main.cjs', 'security.cjs', 'preload-control.cjs', 'preload-display.cjs',
  'build/control.js', 'build/control.css', 'build/control.html',
  'build/display.js', 'build/display.html', 'build/connection-key.cjs',
  'build/icon.ico', 'build/icon.png', 'build/tray.png',
  'build/installer-loading.gif', 'build/installer-preview.png',
];

async function hashFile(file, algorithms = ['sha256']) {
  const hashes = algorithms.map(algorithm => [algorithm, createHash(algorithm)]);
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    for (const [, hash] of hashes) hash.update(chunk);
  }
  return { bytes, ...Object.fromEntries(hashes.map(([algorithm, hash]) => [algorithm, hash.digest('hex').toUpperCase()])) };
}

async function verifyPackage(stageArgument) {
  assert.equal(process.platform, 'win32', 'Package verification uses the Windows 7-Zip shipped with electron-winstaller');
  assert.equal(typeof stageArgument, 'string', 'Usage: node scripts/verify-package.cjs <stage path printed by npm run make>');
  const stage = path.resolve(stageArgument);
  assert.match(path.basename(stage), /^windchime-make-[A-Za-z0-9_-]+$/, 'Expected the make staging directory, not the source or installed application');
  const archive = path.join(stage, 'WindChime-win32-x64/resources/app.asar');
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Unexpected desktop package version');

  const archivePackage = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(archivePackage.version, version, 'Packaged application version differs from source');
  const allowedEntries = new Set(['build', 'package.json', ...runtimeFiles]);
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, ''));
  assert.equal(new Set(entries).size, entries.length, 'Archive contains duplicate entries');
  assert.equal(entries.length, allowedEntries.size, 'Archive does not contain exactly the approved runtime files');
  for (const entry of entries) {
    assert(allowedEntries.has(entry), `Archive contains an unapproved file: ${entry}`);
    const metadata = asar.statFile(archive, entry, false);
    assert(!metadata.link && !metadata.unpacked, `Archive must not reference an external file: ${entry}`);
    if (entry !== 'build') assert(!metadata.files, `Expected a runtime file: ${entry}`);
  }
  // The exact allowlist excludes .env, device vaults, databases, certificates,
  // tests, gateway sources, node_modules, source maps and build scripts. Scan
  // runtime text for recognizable credential literals without printing a match.
  for (const entry of ['package.json', ...runtimeFiles]) {
    const packaged = Buffer.from(asar.extractFile(archive, entry));
    if (entry !== 'package.json') {
      const current = await fs.readFile(path.join(root, entry));
      assert(packaged.equals(current), `Packaged ${entry} differs from the current build`);
    }
    if (/\.(?:c?js|html|css|json)$/.test(entry)) {
      const source = packaged.toString('utf8');
      const credentialLiteral = /\bwc_(?:ctl|disp)_[A-Za-z0-9_-]{43}\b|\bwc_conn_v1\.[A-Za-z0-9_-]{80,}\b|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;
      assert(!credentialLiteral.test(source), `Recognizable credential material found in ${entry}; contents were withheld`);
    }
  }

  const nupkgName = `WindChime-${convertVersion(version)}-full.nupkg`;
  const artifactNames = ['WindChime-Setup.exe', `WindChime-win32-x64-${version}.zip`, 'RELEASES', nupkgName];
  const manifest = new Map();
  for (const line of (await fs.readFile(path.join(artifacts, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)) {
    const match = /^([A-Fa-f0-9]{64})  ([A-Za-z0-9._-]+)  \((\d+) bytes\)$/.exec(line);
    assert(match, 'SHA256SUMS.txt contains an invalid line');
    assert(!manifest.has(match[2]), 'SHA256SUMS.txt contains a duplicate artifact');
    manifest.set(match[2], { sha256: match[1].toUpperCase(), bytes: Number(match[3]) });
  }
  assert.equal(manifest.size, artifactNames.length, 'Checksum manifest must describe exactly this release');
  const hashes = [];
  for (const name of artifactNames) {
    assert(manifest.has(name), `Checksum manifest does not include ${name}`);
    const actual = await hashFile(path.join(artifacts, name), name === nupkgName ? ['sha256', 'sha1'] : ['sha256']);
    assert.equal(actual.bytes, manifest.get(name).bytes, `${name} size differs from SHA256SUMS.txt`);
    assert.equal(actual.sha256, manifest.get(name).sha256, `${name} hash differs from SHA256SUMS.txt`);
    hashes.push({ name, ...actual });
  }
  const releaseLines = (await fs.readFile(path.join(artifacts, 'RELEASES'), 'utf8')).trim().split(/\r?\n/);
  assert.equal(releaseLines.length, 1, 'Expected one full package in RELEASES');
  const release = /^([A-Fa-f0-9]{40}) ([A-Za-z0-9._-]+) (\d+)$/.exec(releaseLines[0]);
  assert(release, 'Invalid RELEASES entry');
  const packageHash = hashes.find(item => item.name === nupkgName);
  assert.equal(release[2], nupkgName, 'RELEASES references a different package version');
  assert.equal(release[1].toUpperCase(), packageHash.sha1, 'RELEASES package hash does not match');
  assert.equal(Number(release[3]), packageHash.bytes, 'RELEASES package size does not match');

  const currentGif = await fs.readFile(path.join(root, 'build/installer-loading.gif'));
  const vendor = path.join(path.dirname(require.resolve('electron-winstaller/package.json')), 'vendor');
  const sevenZip = path.join(vendor, `7z-${process.arch}.exe`);
  let embeddedGif;
  try {
    // Read-only archive extraction to stdout. Setup.exe is DATA, never a program
    // being executed; no installer, uninstaller or temporary extraction runs.
    embeddedGif = execFileSync(sevenZip, ['e', '-so', '-bd', '-bb0', path.join(artifacts, 'WindChime-Setup.exe'), 'background.gif'], {
      windowsHide: true, timeout: 30000, maxBuffer: Math.max(4 * 1024 * 1024, currentGif.length + 128 * 1024),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Unable to read background.gif from the installer with bundled 7-Zip; Setup.exe was not executed');
  }
  assert(embeddedGif.equals(currentGif), 'Installer contains different loading artwork from the current build');
  const sha256 = createHash('sha256').update(embeddedGif).digest('hex').toUpperCase();
  return {
    date: new Date().toISOString(), version, passed: true, archive, entryCount: entries.length,
    runtimeAllowlist: true, noCredentialLiterals: true, matchedFiles: runtimeFiles,
    installerArtwork: { entry: 'background.gif', bytes: embeddedGif.length, sha256, matchesBuild: true },
    checksumManifest: 'SHA256SUMS.txt', releasesVerified: true, hashes,
    executedInstaller: false,
  };
}

if (require.main === module) {
  (async () => {
    assert.equal(process.argv.length, 3, 'Usage: node scripts/verify-package.cjs <stage path printed by npm run make>');
    const report = await verifyPackage(process.argv[2]);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  })().catch(async error => {
    // A failure must not leave an earlier successful report looking current.
    const report = { date: new Date().toISOString(), passed: false, error: error.message, executedInstaller: false };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n').catch(() => {});
    console.error(report.error);
    process.exitCode = 1;
  });
}

module.exports = { verifyPackage };
