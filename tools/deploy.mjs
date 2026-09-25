// Builds the game and publishes game + server as a new version of the genhttp.dev lambda.
//
//   node tools/deploy.mjs ["what this version changes"]
//
// The editor key comes from $GENHTTP_KEY or the git-ignored file .genhttp-key. Keep it secret:
// whoever has it can replace the lambda.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const keyFile = path.join(root, '.genhttp-key');
const key = process.env.GENHTTP_KEY || (fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8').trim());
if (!key) { console.error('No editor key: set GENHTTP_KEY or write it to .genhttp-key'); process.exit(1); }

execFileSync(process.execPath, [path.join(root, 'tools/build.mjs')], { stdio: 'inherit' });

const files = [];
const add = (name, file) => files.push({ name, data: fs.readFileSync(file) });
add('lambda.cs', path.join(root, 'server/lambda.cs'));
for (const f of fs.readdirSync(path.join(root, 'server')).sort()) if (f.endsWith('.cs') && f !== 'lambda.cs') add(f, path.join(root, 'server', f));
for (const f of fs.readdirSync(path.join(root, 'dist')).sort()) add('web/' + f, path.join(root, 'dist', f));

// a minimal zip writer (deflate), enough for the upload endpoint
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name), body = zlib.deflateRawSync(data, { level: 9 }), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body); centrals.push(ch, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const body = zip(files);
const total = files.filter(f => !f.name.endsWith('.cs')).reduce((a, f) => a + f.data.length, 0);
console.log(`${files.length} files, assets ${(total / 1024).toFixed(0)} KB, zip ${(body.length / 1024).toFixed(0)} KB`);

const spec = 'Settlers II-style browser strategy game (three.js), hosted here with a multiplayer mode: a public lobby where 1 to 6 people can gather, chat and start a game together (plus computer opponents), and chat during the game.';
const change = process.argv[2] || 'Publishes the current game and server';
const url = `https://genhttp.dev/api/v1/lambdas/${key}/versions/zip?deploy=true&specification=${encodeURIComponent(spec)}&change=${encodeURIComponent(change)}`;
const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/zip' } });
const text = await res.text();
let out; try { out = JSON.parse(text); } catch { out = null; }
if (!res.ok || !out || (out.deployment && out.deployment.success === false)) { console.error('Deploy failed:', res.status, text.slice(0, 3000)); process.exit(1); }
console.log(`version ${out.version} deployed → https://www.genhttp.dev/lambda/${out.deployment?.lambda?.publicKey || ''}/`);
