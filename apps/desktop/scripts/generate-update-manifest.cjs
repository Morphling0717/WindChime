// Generate a signed WindChime update manifest (latest.json) from a packaged Windows release.
// Usage:
//   node scripts/generate-update-manifest.cjs --version 1.1.0 --setup out/releases/1.1.0/WindChime-Setup-1.1.0.exe \
//     --notes-file out/releases/1.1.0/release-notes-1.1.0.md --out out/releases/1.1.0/latest.json
// Reads Ed25519 PKCS#8 PEM private key from env WINDCHIME_UPDATE_PRIVATE_KEY or --key-file <path>.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function canonicalPayload(manifest) {
  return JSON.stringify({
    schema: manifest.schema,
    version: manifest.version,
    title: manifest.title,
    publishedAt: manifest.publishedAt,
    notes: manifest.notes,
    releasePageUrl: manifest.releasePageUrl,
    windows: {
      fileName: manifest.windows.fileName,
      size: manifest.windows.size,
      sha256: manifest.windows.sha256,
      urls: manifest.windows.urls,
    },
  });
}

function signManifest(manifest, privateKeyPem) {
  const payload = Buffer.from(canonicalPayload(manifest), 'utf8');
  const sig = crypto.sign(null, payload, privateKeyPem);
  return { ...manifest, signature: sig.toString('base64') };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = require('../package.json');
  const version = args.version || pkg.version;
  const setupPath = path.resolve(args.setup || path.join(__dirname, `../out/releases/${version}/WindChime-Setup-${version}.exe`));
  const outPath = path.resolve(args.out || path.join(path.dirname(setupPath), 'latest.json'));
  const feedOrigin = (args['feed-origin'] || 'https://windchime.uliuli.cn').replace(/\/$/, '');
  const repo = args.repo || 'Morphling0717/WindChime';
  const title = args.title || `风铃 ${version}`;

  const bytes = fs.readFileSync(setupPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toLowerCase();
  const fileName = path.basename(setupPath);

  let notes = '';
  if (args['notes-file'] && fs.existsSync(args['notes-file'])) {
    notes = fs.readFileSync(args['notes-file'], 'utf8').replace(/\r\n/g, '\n').trim().slice(0, 1800);
  }

  let privateKeyPem = process.env.WINDCHIME_UPDATE_PRIVATE_KEY || '';
  if (!privateKeyPem && args['key-file']) {
    privateKeyPem = fs.readFileSync(path.resolve(args['key-file']), 'utf8');
  }
  if (!privateKeyPem.trim()) {
    throw new Error('Missing Ed25519 private key (set WINDCHIME_UPDATE_PRIVATE_KEY or pass --key-file)');
  }

  const baseManifest = {
    schema: 1,
    version,
    title,
    publishedAt: new Date().toISOString(),
    notes,
    releasePageUrl: `https://github.com/${repo}/releases/tag/v${version}`,
    windows: {
      fileName,
      size: bytes.length,
      sha256,
      urls: [
        `${feedOrigin}/updates/${encodeURIComponent(fileName)}`,
        `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(fileName)}`,
      ],
    },
  };

  const signed = signManifest(baseManifest, privateKeyPem);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(signed, null, 2) + '\n', 'utf8');
  console.log(`Signed update manifest written to ${outPath}`);
  console.log(`version=${version} size=${bytes.length} sha256=${sha256}`);
}

if (require.main === module) {
  run();
}

module.exports = { canonicalPayload, signManifest };
