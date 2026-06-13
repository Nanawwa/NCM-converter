import { build } from 'esbuild';
import { cpSync } from 'fs';

build({
  entryPoints: ['src/renderer/app.ts'],
  bundle: true,
  platform: 'browser',
  outfile: 'dist/renderer/app.js',
  format: 'iife',
  sourcemap: true,
  minify: false,
}).then(() => {
  cpSync('src/renderer/index.html', 'dist/renderer/index.html');
}).catch(() => process.exit(1));
