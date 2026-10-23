import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
      const html = await readFile('src/ui.html', 'utf8');
      // Split/join avoids `$` replacement patterns in the bundled JS
      const out = html.split('<!-- UI_SCRIPT -->').join(`<script>${js.replace(/<\/script/g, '<\\/script')}</script>`);
      await mkdir('dist', { recursive: true });
      await writeFile('dist/ui.html', out);
      console.log('built dist/ui.html');
    });
  },
};

const codeOpts = {
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017',
  format: 'iife',
  logLevel: 'info',
};

const uiOpts = {
  entryPoints: ['src/ui.ts'],
  bundle: true,
  write: false,
  outfile: 'dist/ui.js',
  target: 'es2019',
  format: 'iife',
  minify: true,
  plugins: [inlineUi],
};

if (watch) {
  const a = await esbuild.context(codeOpts);
  const b = await esbuild.context(uiOpts);
  await Promise.all([a.watch(), b.watch()]);
} else {
  await Promise.all([esbuild.build(codeOpts), esbuild.build(uiOpts)]);
}
