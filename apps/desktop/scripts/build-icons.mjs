import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Export the approved master without redrawing it. ICO embeds PNG images at
// several sizes so Windows can choose the correct taskbar/installer resolution.
export async function buildIcons(root) {
  const master = await readFile(path.resolve(root, '../../assets/branding/windchime-logo-v1-master.png'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(size => sharp(master).resize(size, size).png().toBuffer()));
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
  ]);
}
