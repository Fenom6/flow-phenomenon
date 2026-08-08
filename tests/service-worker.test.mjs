import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workerSource = readFileSync(join(root, 'sw.js'), 'utf8');
const cacheRevision = workerSource.match(/CACHE_NAME = `\$\{CACHE_PREFIX\}([^`]+)`/)[1];
const currentCacheName = `flow-phenomenon-${cacheRevision}`;

function response(body) {
  return { body, ok: true, clone: () => response(body) };
}

function createHarness({ cacheKeys = [], fetchImpl = async () => response('network') } = {}) {
  const listeners = new Map();
  const cacheStore = new Map();
  const deletedCaches = [];
  const precachedAssets = [];
  let currentFetch = fetchImpl;
  let clientsClaimed = false;
  let skipWaitingCalled = false;

  const normalizeKey = (key) => (typeof key === 'string' ? key : key.url);
  const cache = {
    addAll: async (assets) => { precachedAssets.push(...assets); },
    match: async (key) => cacheStore.get(normalizeKey(key)),
    put: async (key, value) => { cacheStore.set(normalizeKey(key), value); },
  };

  const context = vm.createContext({
    URL,
    caches: {
      delete: async (key) => { deletedCaches.push(key); return true; },
      keys: async () => cacheKeys,
      open: async () => cache,
    },
    fetch: (request) => currentFetch(request),
    self: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      clients: { claim: async () => { clientsClaimed = true; } },
      location: { origin: 'https://example.test' },
      skipWaiting: async () => { skipWaitingCalled = true; },
    },
  });

  vm.runInContext(workerSource, context, { filename: 'sw.js' });
  return {
    cacheStore,
    deletedCaches,
    get clientsClaimed() { return clientsClaimed; },
    listeners,
    precachedAssets,
    setFetch: (nextFetch) => { currentFetch = nextFetch; },
    get skipWaitingCalled() { return skipWaitingCalled; },
  };
}

function dispatchWaitable(listener, event = {}) {
  let completion;
  listener({ ...event, waitUntil: (promise) => { completion = promise; } });
  return completion;
}

function dispatchFetch(listener, request) {
  let handled;
  listener({ request, respondWith: (promise) => { handled = promise; } });
  return handled;
}

test('install precaches the canonical app shell and activates immediately', async () => {
  const harness = createHarness();
  await dispatchWaitable(harness.listeners.get('install'));

  assert.ok(harness.precachedAssets.includes('./index.html'));
  assert.ok(harness.precachedAssets.includes('./icons/icon-512.png'));
  assert.equal(harness.precachedAssets.includes('./'), false);
  assert.equal(harness.skipWaitingCalled, true);
});

test('activation removes only stale Flow Phenomenon caches', async () => {
  const harness = createHarness({
    cacheKeys: [
      'flow-phenomenon-oldrevision',
      currentCacheName,
      'another-project-v7',
    ],
  });
  await dispatchWaitable(harness.listeners.get('activate'));

  assert.deepEqual(harness.deletedCaches, ['flow-phenomenon-oldrevision']);
  assert.equal(harness.clientsClaimed, true);
});

test('online navigation refreshes both URL and canonical offline fallback', async () => {
  const harness = createHarness({ fetchImpl: async () => response('fresh') });
  const request = { method: 'GET', mode: 'navigate', url: 'https://example.test/' };
  harness.cacheStore.set(request.url, response('stale-root'));
  harness.cacheStore.set('./index.html', response('stale-index'));

  const online = await dispatchFetch(harness.listeners.get('fetch'), request);
  assert.equal(online.body, 'fresh');
  assert.equal(harness.cacheStore.get(request.url).body, 'fresh');
  assert.equal(harness.cacheStore.get('./index.html').body, 'fresh');

  harness.setFetch(async () => { throw new Error('offline'); });
  const offline = await dispatchFetch(harness.listeners.get('fetch'), request);
  assert.equal(offline.body, 'fresh');
});
