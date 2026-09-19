import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const background = '#F4F8FC';

// NSIS paints these surfaces as opaque bitmaps. The glass lighting belongs to
// the artwork; it is not a claim that the native installer blurs the desktop.
function sidebarSvg(logo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="328" height="628" viewBox="0 0 164 314">
    <defs>
      <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#eaf3ff"/><stop offset="0.55" stop-color="#e9f5f6"/><stop offset="1" stop-color="${background}"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0.7" y2="1">
        <stop stop-color="#ffffff" stop-opacity="0.82"/><stop offset="0.48" stop-color="#ffffff" stop-opacity="0.30"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.70"/>
      </linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#ffffff"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.94"/>
      </linearGradient>
      <filter id="ambient" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="26"/></filter>
      <filter id="shadow" x="-40%" y="-30%" width="180%" height="180%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#416788" flood-opacity="0.08"/></filter>
    </defs>
    <rect width="164" height="314" fill="${background}"/>
    <rect x="0" y="0" width="158" height="314" fill="url(#surface)"/>
    <g filter="url(#ambient)">
      <ellipse cx="28" cy="91" rx="62" ry="71" fill="#bbd7fb" opacity="0.66"/>
      <ellipse cx="122" cy="227" rx="58" ry="63" fill="#b8e9df" opacity="0.52"/>
    </g>
    <circle cx="-10" cy="28" r="59" fill="none" stroke="#ffffff" stroke-opacity="0.67"/>
    <circle cx="-10" cy="28" r="72" fill="none" stroke="#ffffff" stroke-opacity="0.42"/>
    <path d="M-23 267C22 218 67 340 160 274" fill="none" stroke="#ffffff" stroke-opacity="0.61" stroke-width="0.85"/>
    <rect x="12.5" y="16.5" width="133" height="280" rx="21" fill="url(#glass)" stroke="url(#edge)" filter="url(#shadow)"/>
    <path d="M35 17H122" stroke="#ffffff" stroke-opacity="0.95" stroke-linecap="round"/>
    <image x="27" y="40" width="104" height="225" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${logo}"/>
    <path d="M65 278H93" stroke="#afcbd3" stroke-opacity="0.7" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="158" width="6" height="314" fill="${background}"/>
  </svg>`;
}

function headerSvg(logo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="114" viewBox="0 0 150 57">
    <defs>
      <radialGradient id="light"><stop stop-color="#d0e8f7" stop-opacity="0.65"/><stop offset="1" stop-color="${background}" stop-opacity="0"/></radialGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffffff" stop-opacity="0.83"/><stop offset="1" stop-color="#f4ffff" stop-opacity="0.33"/></linearGradient>
    </defs>
    <rect width="150" height="57" fill="${background}"/>
    <ellipse cx="111" cy="26" rx="49" ry="36" fill="url(#light)"/>
    <rect x="8.5" y="10.5" width="133" height="36" rx="12" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.90"/>
    <image x="18" y="18" width="113" height="21.856" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${logo}"/>
  </svg>`;
}

// BITMAPINFOHEADER, BI_RGB, 24-bit BGR, bottom-up rows padded to DWORDs. This
// avoids alpha/compression variants that Windows installer controls may reject.
function windowsBitmap(rgb, width, height) {
  const rowSize = Math.ceil(width * 3 / 4) * 4;
  const pixelsSize = rowSize * height;
  if (rgb.length !== width * height * 3) throw new Error('Unexpected wizard artwork pixel format');
  const bytes = Buffer.alloc(54 + pixelsSize);
  bytes.write('BM', 0, 2, 'ascii');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(pixelsSize, 34);
  bytes.writeInt32LE(3780, 38);
  bytes.writeInt32LE(3780, 42);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const input = (y * width + x) * 3;
      const output = 54 + (height - y - 1) * rowSize + x * 3;
      bytes[output] = rgb[input + 2];
      bytes[output + 1] = rgb[input + 1];
      bytes[output + 2] = rgb[input];
    }
  }
  return bytes;
}

export async function buildWizardArt(root) {
  const output = path.join(root, 'build/installer');
  const branding = path.resolve(root, '../../assets/branding/windchime_logo/02_Lockups');
  await mkdir(output, { recursive: true });
  const [stackedLogo, headerLogo] = await Promise.all([
    readFile(path.join(branding, 'WindChime_stacked_glass_light.png')),
    readFile(path.join(branding, 'WindChime_header_navy.png')),
  ]);
  const artwork = [
    { name: 'wizard-sidebar', width: 164, height: 314, svg: sidebarSvg(stackedLogo.toString('base64')) },
    { name: 'wizard-header', width: 150, height: 57, svg: headerSvg(headerLogo.toString('base64')) },
  ];
  for (const item of artwork) {
    const rgb = await sharp(Buffer.from(item.svg)).resize(item.width, item.height)
      .flatten({ background }).removeAlpha().toColourspace('srgb').raw().toBuffer();
    await Promise.all([
      writeFile(path.join(output, `${item.name}.bmp`), windowsBitmap(rgb, item.width, item.height)),
      sharp(rgb, { raw: { width: item.width, height: item.height, channels: 3 } })
        .png().toFile(path.join(output, `${item.name}.png`)),
    ]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWizardArt(fileURLToPath(new URL('../', import.meta.url)));
}
