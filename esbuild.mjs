import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

function copyCodicons() {
  const srcDir = join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
  const destDir = join(__dirname, 'media');
  mkdirSync(destDir, { recursive: true });
  for (const f of ['codicon.css', 'codicon.ttf']) {
    const src = join(srcDir, f);
    if (existsSync(src)) copyFileSync(src, join(destDir, f));
  }
}

// webview/ 不进 vsix，样式表随 bundle 一起落到 dist/
function copyWebviewAssets() {
  const destDir = join(__dirname, 'dist');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(join(__dirname, 'webview', 'style.css'), join(destDir, 'style.css'));
}

const extensionCtx = await esbuild.context({
  entryPoints: [join(__dirname, 'src', 'extension.ts')],
  bundle: true,
  outfile: join(__dirname, 'dist', 'extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
});

const webviewCtx = await esbuild.context({
  entryPoints: [join(__dirname, 'webview', 'main.ts')],
  bundle: true,
  outfile: join(__dirname, 'dist', 'webview.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
});

copyCodicons();
copyWebviewAssets();

if (watch) {
  await extensionCtx.watch();
  await webviewCtx.watch();
  console.log('watching...');
} else {
  await extensionCtx.rebuild();
  await webviewCtx.rebuild();
  await extensionCtx.dispose();
  await webviewCtx.dispose();
}
