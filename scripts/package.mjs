import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const assets = ['index.html', 'app.js', 'styles.css', 'staticwebapp.config.json'];
const html = await readFile('index.html', 'utf8');
for (const asset of ['app.js', 'styles.css']) {
  assert(html.includes(`"${asset}"`), `Missing entrypoint reference: ${asset}`);
}
JSON.parse(await readFile('staticwebapp.config.json', 'utf8'));
for (const asset of assets) assert((await readFile(asset)).length > 0, `Empty asset: ${asset}`);
await mkdir('dist', { recursive: true });
for (const asset of assets) await copyFile(asset, `dist/${asset}`);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await writeFile('dist/release.json', JSON.stringify({ application: 'cornerstone-kiosk', commit }) + '\n');
console.log(`Validated and packaged ${assets.length} assets for ${commit}`);
