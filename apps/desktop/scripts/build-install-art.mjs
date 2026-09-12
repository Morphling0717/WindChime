import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const width = 640;
const height = 400;
const frameCount = 36;
const frameDelay = 90;

// Squirrel renders its loading GIF at the image's own dimensions. The material
// is drawn into the artwork: GIF cannot blur whatever is behind its window.
// Only the small activity dots and ambient light move; they do not imply an
// installation percentage. The approved logo is embedded without redrawing it.
function installerFrame(logo, frame) {
  const phase = frame / frameCount * Math.PI * 2;
  const mintX = 154 + Math.sin(phase) * 7;
  const blueY = 105 + Math.cos(phase) * 9;
  const dots = [0, 1, 2].map(index => {
    const opacity = 0.3 + (Math.sin(phase - index * 0.8) + 1) * 0.35;
    return `<circle cx="${511 + index * 13}" cy="325" r="3" fill="#258e88" opacity="${opacity.toFixed(3)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#f4fbff"/><stop offset="0.52" stop-color="#e9f5fb"/><stop offset="1" stop-color="#eff9f6"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0.8" y2="1">
        <stop stop-color="#ffffff" stop-opacity="0.83"/><stop offset="0.48" stop-color="#ffffff" stop-opacity="0.40"/><stop offset="1" stop-color="#f3ffff" stop-opacity="0.76"/>
      </linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#ffffff"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.88"/>
      </linearGradient>
      <filter id="ambient" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="33"/></filter>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="12" stdDeviation="13" flood-color="#40818d" flood-opacity="0.11"/></filter>
      <clipPath id="window"><rect x="8" y="8" width="624" height="384" rx="32"/></clipPath>
    </defs>
    <g clip-path="url(#window)">
      <rect x="8" y="8" width="624" height="384" rx="32" fill="url(#surface)"/>
      <g filter="url(#ambient)">
        <ellipse cx="${mintX.toFixed(2)}" cy="282" rx="127" ry="93" fill="#8ce5cf" opacity="0.62"/>
        <ellipse cx="485" cy="${blueY.toFixed(2)}" rx="124" ry="109" fill="#b7d6ff" opacity="0.70"/>
        <ellipse cx="357" cy="382" rx="112" ry="58" fill="#c8f3ed" opacity="0.75"/>
      </g>
      <circle cx="534" cy="92" r="87" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.5"/>
      <circle cx="534" cy="92" r="101" fill="none" stroke="#ffffff" stroke-opacity="0.32"/>
      <path d="M-10 317C112 203 138 456 338 371" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.5"/>
      <rect x="40" y="40" width="560" height="320" rx="26" fill="url(#glass)" stroke="url(#edge)" stroke-width="1.5" filter="url(#shadow)"/>
      <path d="M65 41H573" stroke="#ffffff" stroke-opacity="0.9" stroke-linecap="round"/>
      <text x="72" y="77" fill="#63818b" font-family="Segoe UI, sans-serif" font-size="10" font-weight="600" letter-spacing="2.1">WINDCHIME DESKTOP</text>
      <rect x="499" y="58" width="69" height="25" rx="12.5" fill="#ffffff" fill-opacity="0.70" stroke="#ffffff"/>
      <text x="533.5" y="74.5" text-anchor="middle" fill="#5c7b86" font-family="Segoe UI, sans-serif" font-size="10.5">Windows</text>
      <image x="100" y="83" width="440" height="227.34" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${logo}"/>
      <text x="299" y="284" fill="#597885" font-family="Microsoft YaHei UI, Microsoft YaHei, sans-serif" font-size="12">让每封来信，从容上场。</text>
      <path d="M72 309H568" stroke="#aac8ce" stroke-opacity="0.33"/>
      <circle cx="80" cy="324" r="4" fill="#54a89f"/>
      <text x="95" y="329" fill="#416572" font-family="Microsoft YaHei UI, Microsoft YaHei, sans-serif" font-size="12">正在安装风铃，请稍候</text>
      ${dots}
    </g>
    <rect x="8.75" y="8.75" width="622.5" height="382.5" rx="31.25" fill="none" stroke="#ffffff" stroke-opacity="0.86" stroke-width="1.5"/>
  </svg>`;
}

export async function buildInstallArt(root) {
  const output = path.join(root, 'build');
  await mkdir(output, { recursive: true });
  // Use the delivered horizontal lockup intact: it includes the glass chime
  // and both approved wordmarks, with their intended proportions and spacing.
  const logo = (await readFile(path.resolve(root, '../../assets/branding/windchime_logo/02_Lockups/WindChime_horizontal_glass_light.png'))).toString('base64');
  const frames = [];
  // Bound rasterization concurrency so ordinary UI builds do not fan out into
  // dozens of large SVG / PNG decoders on a developer's machine.
  for (let frame = 0; frame < frameCount; frame++) {
    frames.push(await sharp(Buffer.from(installerFrame(logo, frame))).ensureAlpha().raw().toBuffer());
  }
  const loadingGif = await sharp(Buffer.concat(frames), {
    raw: { width, height: height * frameCount, channels: 4, pageHeight: height },
  }).gif({ loop: 0, delay: Array(frameCount).fill(frameDelay), colours: 256, dither: 0.2, effort: 7 }).toBuffer();
  const metadata = await sharp(loadingGif, { animated: true }).metadata();
  if (metadata.width !== width || metadata.pageHeight !== height || metadata.pages !== frameCount || metadata.loop !== 0 || metadata.delay?.some(delay => delay !== frameDelay)) {
    throw new Error('Installer artwork did not encode as the expected looping animation');
  }
  await Promise.all([
    writeFile(path.join(output, 'installer-loading.gif'), loadingGif),
    sharp(frames[0], { raw: { width, height, channels: 4 } }).png().toFile(path.join(output, 'installer-preview.png')),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildInstallArt(fileURLToPath(new URL('../', import.meta.url)));
}
