// Génère les icônes PNG de l'app à partir de public/icon.svg (à relancer si l'icône change).
import sharp from 'sharp';
const src = new URL('../public/icon.svg', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const out = (f) => new URL(`../public/${f}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
for (const [file, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(decodeURIComponent(src), { density: 300 }).resize(size, size).png().toFile(decodeURIComponent(out(file)));
}
console.log('✓ icônes générées');
