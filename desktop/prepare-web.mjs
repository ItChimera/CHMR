import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const distDir = path.join(repoRoot, 'dist');
const webDir = path.join(__dirname, 'web');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('Missing dist/index.html. Run "npm run build" in the repository root first.');
  process.exit(1);
}

fs.rmSync(webDir, { recursive: true, force: true });
fs.cpSync(distDir, webDir, { recursive: true });

const icoSrc = path.join(repoRoot, 'public', 'favicon.ico');
const pngSrc = path.join(repoRoot, 'public', 'pwa-512x512.png');

if (fs.existsSync(icoSrc)) {
  fs.copyFileSync(icoSrc, path.join(__dirname, 'icon.ico'));
}
if (fs.existsSync(pngSrc)) {
  fs.copyFileSync(pngSrc, path.join(__dirname, 'icon.png'));
}

console.log('Prepared desktop/web bundle and icons from dist/ and public/.');
