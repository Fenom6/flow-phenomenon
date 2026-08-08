import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const handledMotionEvents = [];
const handledOrientationEvents = [];

function P5Stub() {}
P5Stub.prototype._ondevicemotion = function originalMotionHandler(event) {
  handledMotionEvents.push(event);
};
P5Stub.prototype._ondeviceorientation = function originalOrientationHandler(event) {
  event.beta = 999;
  handledOrientationEvents.push(event);
};

const context = vm.createContext({
  console,
  document: {
    getElementById: () => null,
    addEventListener: () => {},
  },
  location: { hostname: '127.0.0.1', protocol: 'http:' },
  navigator: {},
  performance: { now: () => 1000 },
  screen: { orientation: null },
  window: {
    FlowCore: null,
    addEventListener: () => {},
    isSecureContext: true,
    matchMedia: () => ({ matches: false }),
    p5: P5Stub,
  },
});

vm.runInContext(readFileSync(join(root, 'flow-core.js'), 'utf8'), context, { filename: 'flow-core.js' });
context.window.FlowCore = context.FlowCore;
vm.runInContext(readFileSync(join(root, 'app.js'), 'utf8'), context, { filename: 'app.js' });

const beginPermissionRequest = vm.runInContext('beginPermissionRequest', context);

test('p5 motion guard ignores nullable acceleration values', () => {
  const handler = P5Stub.prototype._ondevicemotion;
  assert.doesNotThrow(() => handler({ acceleration: null }));
  assert.doesNotThrow(() => handler({ acceleration: { x: 1, y: null, z: 3 } }));
  assert.equal(handledMotionEvents.length, 0);

  const validEvent = { acceleration: { x: 1, y: 2, z: 3 } };
  handler(validEvent);
  assert.deepEqual(handledMotionEvents, [validEvent]);
});

test('p5 orientation conversion cannot mutate the shared browser event', () => {
  const browserEvent = { alpha: 5, beta: 20, gamma: 10 };
  P5Stub.prototype._ondeviceorientation(browserEvent);

  assert.deepEqual(browserEvent, { alpha: 5, beta: 20, gamma: 10 });
  assert.equal(handledOrientationEvents.length, 1);
  assert.equal(handledOrientationEvents[0].beta, 999);
  assert.notEqual(handledOrientationEvents[0], browserEvent);
});

test('permission requests classify supported, denied, and failed APIs', async () => {
  assert.equal(await beginPermissionRequest(undefined), 'unsupported');
  assert.equal(await beginPermissionRequest(function NoPromptNeeded() {}), 'not-required');

  let requestCount = 0;
  function Granted() {}
  Granted.requestPermission = () => {
    requestCount += 1;
    return Promise.resolve('granted');
  };
  assert.equal(await beginPermissionRequest(Granted), 'granted');

  function Denied() {}
  Denied.requestPermission = () => Promise.resolve('denied');
  assert.equal(await beginPermissionRequest(Denied), 'denied');

  function Rejected() {}
  Rejected.requestPermission = () => Promise.reject(new Error('blocked'));
  assert.equal(await beginPermissionRequest(Rejected), 'error');

  function Throws() {}
  Throws.requestPermission = () => { throw new Error('no activation'); };
  assert.equal(await beginPermissionRequest(Throws), 'error');
  assert.equal(requestCount, 1);
});
