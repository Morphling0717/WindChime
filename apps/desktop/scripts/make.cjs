const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { api } = require('@electron-forge/core');
const { buildTransactionEngine } = require('./build-transaction-engine.cjs');
const { generateInstallerLicenses } = require('./licenses.cjs');
const { buildGlassSetup } = require('./build-glass-setup.cjs');
async function run() {
  const root = path.resolve(__dirname, '..');
  // Keep generated packaging output in an isolated ASCII staging directory.
  // Stage only generated packaging output in an ASCII directory, not source files.
  const parent = path.resolve(process.env.WINDCHIME_BUILD_ROOT || os.tmpdir());
  if (/[^\x00-\x7f]/.test(parent)) throw new Error('Set WINDCHIME_BUILD_ROOT to a writable ASCII path (for example C:\\WindChimeBuild).');
  await fs.mkdir(parent, { recursive: true });
  const outDir = await fs.mkdtemp(path.join(parent, 'windchime-make-'));
  await generateInstallerLicenses({ root });
  const results = await api.make({ dir: root, platform: 'win32', arch: 'x64', outDir });
  const packaged = path.join(outDir, 'WindChime-win32-x64');
  const {engine,payload}=await buildTransactionEngine({root,packaged,outputDirectory:path.join(outDir,'nsis')});
  const { version } = require('../package.json');
  const setup=path.join(outDir,`WindChime-Setup-${version}.exe`);
  await buildGlassSetup({root,packaged:payload,engine,output:setup});
  const destination = path.join(root, 'out', 'releases', version); await fs.mkdir(destination, { recursive: true });
  const hashes = [];
  for (const artifact of [...results.flatMap(result => result.artifacts), setup]) {
    const output = path.join(destination, path.basename(artifact)); await fs.copyFile(artifact, output); console.log(output);
    const bytes = await fs.readFile(output);
    hashes.push(`${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(output)}`);
  }
  await fs.writeFile(path.join(destination, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
  await fs.writeFile(path.join(destination, 'build-info.json'), JSON.stringify({ version, installer: 'wpf-glass-transaction-engine', stage: outDir, packaged, payload, engine, createdAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`Build staging retained at ${outDir}`);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
