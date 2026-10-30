// Format conversion only: derive Windows icon sizes from the generated master PNG.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const canvasRequire = createRequire(require.resolve('pdf-parse'));
const { createCanvas, loadImage } = canvasRequire('@napi-rs/canvas');
const original = await loadImage('assets/branding/dragon-avatar.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const size of sizes) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const ratio = Math.min(size / original.width, size / original.height);
  const w = original.width * ratio, h = original.height * ratio;
  ctx.drawImage(original, (size - w) / 2, (size - h) / 2, w, h);
  const png = canvas.toBuffer('image/png'); images.push(png);
  await writeFile(`assets/branding/dragon-${size}.png`, png);
}
const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16; header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += images[i].length;
}
await writeFile('assets/branding/dragon.ico', Buffer.concat([header, ...images]));
console.log('Created PNG sizes and 7-frame Windows ICO.');
