import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Use the approved assets for their intended sizes: the small mono symbol at
// 16/24/32 pixels and the glass app artwork at larger resolutions.
export async function buildIcons(root) {
  const branding = path.resolve(root, '../../assets/branding/windchime_logo');
  const master = await readFile(path.join(branding, '05_App_Icons/WindChime_app_dark_1024.png'));
  const smallSymbol = await readFile(path.join(branding, '04_Monochrome/WindChime_symbol_small_white.svg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(async size => {
    if (size > 32) return sharp(master).resize(size, size).png().toBuffer();
    // The delivered white small-size symbol on its brand navy tile remains
    // visible on either a light or a dark taskbar, without recoloring the mark.
    const padding = size === 16 ? 1 : 2;
    const symbol = await sharp(smallSymbol).resize(size - padding * 2, size - padding * 2).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: '#263A58' } })
      .composite([{ input: symbol, left: padding, top: padding }]).png().toBuffer();
  }));
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((bytes, index) => {
    const entry = 6 + 16 * index;
    directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(bytes.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  await Promise.all([
    writeFile(path.join(root, 'build/icon.ico'), Buffer.concat([directory, ...images])),
    writeFile(path.join(root, 'build/icon.png'), images.at(-1)),
    writeFile(path.join(root, 'build/tray.png'), images[2]),
    copyFile(path.join(branding, '02_Lockups/WindChime_header_navy.svg'), path.join(root, 'build/brand-header.svg')),
    copyFile(path.join(branding, '04_Monochrome/WindChime_symbol_small_navy.svg'), path.join(root, 'build/brand-symbol.svg')),
  ]);
}
