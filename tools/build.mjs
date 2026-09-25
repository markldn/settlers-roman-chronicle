// Bundles the game into dist/ for hosting: one minified script (game code + the parts of three.js it
// uses), the stylesheet and index.html. The unbundled sources keep working as they are (./run.sh).
//
//   node tools/build.mjs
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'none',
  alias: { three: path.join(root, 'vendor/three/three.module.js'), 'three/addons': path.join(root, 'vendor/three/addons') },
  outfile: path.join(dist, 'game.js'),
  logLevel: 'warning',
});

const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(dist, f))).digest('hex').slice(0, 10);
fs.copyFileSync(path.join(root, 'style.css'), path.join(dist, 'style.css'));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('<script type="module" src="src/main.js"></script>', `<script type="module" src="game.js?v=${hash('game.js')}"></script>`);
html = html.replace('<link rel="stylesheet" href="style.css">', `<link rel="stylesheet" href="style.css?v=${hash('style.css')}">`);
fs.writeFileSync(path.join(dist, 'index.html'), html);

for (const f of fs.readdirSync(dist)) console.log(`dist/${f}`.padEnd(22), (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0).padStart(6), 'KB');
