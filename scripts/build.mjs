import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makeIcon } from './icon.mjs';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
const icon = makeIcon();
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/desktop/main.ts')], outfile: resolve(root, 'dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false }),
  build({ entryPoints: [resolve(root, 'src/desktop/preload.ts')], outfile: resolve(root, 'dist/preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false }),
  build({ entryPoints: [resolve(root, 'src/renderer/index.ts')], outfile: resolve(root, 'dist/renderer/app.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: false }),
  copyFile(resolve(root, 'src/renderer/index.html'), resolve(root, 'dist/renderer/index.html')),
  copyFile(resolve(root, 'src/renderer/styles.css'), resolve(root, 'dist/renderer/styles.css')),
  writeFile(resolve(root, 'dist/icon.ico'), icon.ico),
]);
console.log('Mosslight desktop build complete.');
