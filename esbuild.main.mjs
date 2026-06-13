import { build } from 'esbuild';

async function main() {
  // Build main process
  await build({
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/main/index.js',
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
    minify: false,
  });

  // Build preload script
  await build({
    entryPoints: ['src/main/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/main/preload.js',
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
    minify: false,
  });
}

main().catch(() => process.exit(1));
