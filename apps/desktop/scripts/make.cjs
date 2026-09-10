const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { api } = require('@electron-forge/core');
async function run() {
  const root = path.resolve(__dirname, '..');
  // Squirrel's PE resource editor does not reliably accept non-ASCII output paths.
  // Stage only generated packaging output in an ASCII directory, not source files.
  const parent = path.resolve(process.env.WINDCHIME_BUILD_ROOT || os.tmpdir());
  if (/[^\x00-\x7f]/.test(parent)) throw new Error('Set WINDCHIME_BUILD_ROOT to a writable ASCII path (for example C:\\WindChimeBuild).');
  await fs.mkdir(parent, { recursive: true });
  const outDir = await fs.mkdtemp(path.join(parent, 'windchime-make-'));
  const results = await api.make({ dir: root, platform: 'win32', arch: 'x64', outDir });
  const destination = path.join(root, 'out', 'installers'); await fs.mkdir(destination, { recursive: true });
  const hashes = [];
  for (const result of results) for (const artifact of result.artifacts) {
    const output = path.join(destination, path.basename(artifact)); await fs.copyFile(artifact, output); console.log(output);
    const bytes = await fs.readFile(output);
    hashes.push(`${createHash('sha256').update(bytes).digest('hex').toUpperCase()}  ${path.basename(output)}  (${bytes.length} bytes)`);
  }
  await fs.writeFile(path.join(destination, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
  console.log(`Build staging retained at ${outDir}`);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
