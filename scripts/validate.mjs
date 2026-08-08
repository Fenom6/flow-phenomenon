import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  'index.html',
  'styles.css',
  'flow-core.js',
  'app.js',
  'sw.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/p5.min.js',
  'vendor/p5.LICENSE.txt',
  'vendor/THIRD_PARTY_NOTICES.txt',
  'vendor/README.md',
  'LICENSE',
  'README.md',
  'tests/flow-core.test.mjs',
  'tests/app-guards.test.mjs',
  'tests/service-worker.test.mjs',
];

for (const relativePath of requiredFiles) {
  assert.ok(existsSync(join(root, relativePath)), `Missing required file: ${relativePath}`);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const app = readFileSync(join(root, 'app.js'), 'utf8');
const flowCore = readFileSync(join(root, 'flow-core.js'), 'utf8');
const serviceWorker = readFileSync(join(root, 'sw.js'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const thirdPartyNotices = readFileSync(join(root, 'vendor/THIRD_PARTY_NOTICES.txt'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));

new vm.Script(app, { filename: 'app.js' });
new vm.Script(flowCore, { filename: 'flow-core.js' });
new vm.Script(serviceWorker, { filename: 'sw.js' });

assert.match(html, /<button\s+id="start-btn"/, 'Start control must be a native button');
assert.match(html, /role="status"/, 'A live status region is required');
const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
assert.ok(cspMatch, 'CSP meta policy is required');
const csp = cspMatch[1];
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]) {
  assert.ok(csp.includes(directive), `CSP is missing: ${directive}`);
}
assert.doesNotMatch(csp, /'unsafe-(?:eval|inline)'/, 'CSP must not allow unsafe script or style execution');
assert.match(html, /viewport-fit=cover/, 'Safe-area viewport support is required');
assert.doesNotMatch(html, /user-scalable\s*=\s*no/i, 'Browser zoom must not be disabled');
assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i, 'Runtime scripts must be same-origin');
assert.doesNotMatch(html, /cdnjs|jsdelivr|unpkg/i, 'Third-party CDN references are not allowed in the app shell');
assert.match(styles, /prefers-reduced-motion/, 'Reduced-motion styles are required');
assert.doesNotMatch(styles, /touch-action:\s*none/i, 'Pinch zoom must not be disabled');
assert.equal((readme.match(/```/g) || []).length % 2, 0, 'README code fences must be balanced');
for (const notice of ['core-js 3.6.5', 'opentype.js 0.9.0', 'ieee754 1.1.13', 'libtess 1.2.2']) {
  assert.ok(thirdPartyNotices.includes(notice), `Third-party notice is missing: ${notice}`);
}

assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Manifest icons are required');
for (const icon of manifest.icons) {
  const iconPath = icon.src.replace(/^\.\//, '');
  assert.ok(existsSync(join(root, iconPath)), `Manifest icon does not exist: ${icon.src}`);
  if (icon.type === 'image/png') {
    const bytes = readFileSync(join(root, iconPath));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${icon.src} is not a PNG`);
    const [declaredWidth, declaredHeight] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16), declaredWidth, `${icon.src} width differs from manifest`);
    assert.equal(bytes.readUInt32BE(20), declaredHeight, `${icon.src} height differs from manifest`);
  }
}

const appShellAssets = [
  'index.html',
  'styles.css',
  'flow-core.js',
  'app.js',
  'vendor/p5.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const appShellMatch = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
assert.ok(appShellMatch, 'Service worker APP_SHELL is missing');
const declaredShellAssets = [...appShellMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(declaredShellAssets, appShellAssets.map((asset) => `./${asset}`), 'Service worker app shell differs from the release asset list');

const shellHasher = createHash('sha256');
for (const asset of appShellAssets) {
  shellHasher.update(asset);
  shellHasher.update('\0');
  shellHasher.update(readFileSync(join(root, asset)));
  shellHasher.update('\0');
}
const expectedCacheRevision = shellHasher.digest('hex').slice(0, 12);
const cacheRevisionMatch = serviceWorker.match(/CACHE_NAME = `\$\{CACHE_PREFIX\}([a-f0-9_]+)`/);
assert.ok(cacheRevisionMatch, 'Service worker cache revision is missing');
assert.equal(cacheRevisionMatch[1], expectedCacheRevision, `Cache revision must be ${expectedCacheRevision}`);

assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\)/, 'Cache cleanup must be limited to this app');

const p5Bytes = readFileSync(join(root, 'vendor/p5.min.js'));
const p5Hash = createHash('sha256').update(p5Bytes).digest('hex').toUpperCase();
assert.equal(
  p5Hash,
  '726AC96626B93F5BCAFF83A910B6C60D3A9728F063E0EB73B5D0819FFC356915',
  'Vendored p5.js differs from the recorded 1.9.0 distribution',
);

const p5LicenseBytes = readFileSync(join(root, 'vendor/p5.LICENSE.txt'));
const p5LicenseHash = createHash('sha256').update(p5LicenseBytes).digest('hex').toUpperCase();
assert.equal(
  p5LicenseHash,
  'EB2F25F8F165D5F20682C1CE7E99CE69144ECFD80FBED8C17DFD327ECD8B6CB6',
  'Vendored p5.js license differs from the recorded 1.9.0 license',
);

console.log(`Validation passed: ${requiredFiles.length} files, JavaScript syntax, manifest, CSP, accessibility hooks, and vendored p5.js hash.`);
