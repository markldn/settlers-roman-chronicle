// Runs the multiplayer server locally, exactly as it runs on genhttp.dev: server/lambda.cs is pasted
// into a small host program under .dev-server/, the built game (dist/) is served from its assets.
//
//   node tools/build.mjs && node tools/dev-server.mjs        (PORT=8961 by default)
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.dev-server');
const tpl = path.join(root, 'tools/devserver');

if (!fs.existsSync(path.join(root, 'dist/index.html'))) { console.error('Build the game first: node tools/build.mjs'); process.exit(1); }

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith('.cs')) fs.rmSync(path.join(out, f));
fs.copyFileSync(path.join(tpl, 'devserver.csproj'), path.join(out, 'devserver.csproj'));
fs.copyFileSync(path.join(tpl, 'Folder.cs'), path.join(out, 'Folder.cs'));
fs.copyFileSync(path.join(tpl, 'GlobalUsings.cs'), path.join(out, 'GlobalUsings.cs'));
const snippet = fs.readFileSync(path.join(root, 'server/lambda.cs'), 'utf8');
fs.writeFileSync(path.join(out, 'Program.cs'), fs.readFileSync(path.join(tpl, 'Program.template.cs'), 'utf8').replace('/*LAMBDA*/', () => snippet));
for (const f of fs.readdirSync(path.join(root, 'server'))) if (f.endsWith('.cs') && f !== 'lambda.cs') fs.copyFileSync(path.join(root, 'server', f), path.join(out, f));
const web = path.join(out, 'assets/web');
fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'dist'))) fs.copyFileSync(path.join(root, 'dist', f), path.join(web, f));

const p = spawn('dotnet', ['run', '--project', out], { stdio: 'inherit', cwd: out, env: { ...process.env, PORT: process.env.PORT || '8961' } });
p.on('exit', (code) => process.exit(code ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => p.kill(s));
