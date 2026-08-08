import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const context = vm.createContext({});
vm.runInContext(readFileSync(join(root, 'flow-core.js'), 'utf8'), context, { filename: 'flow-core.js' });
const core = context.FlowCore;

test('orientation axes follow the visible screen angle', () => {
  assert.deepEqual({ ...core.orientationToScreen(20, 10, 0) }, { x: 10, y: 20 });
  assert.deepEqual({ ...core.orientationToScreen(20, 10, 90) }, { x: 20, y: -10 });
  assert.deepEqual({ ...core.orientationToScreen(20, 10, 180) }, { x: -10, y: -20 });
  assert.deepEqual({ ...core.orientationToScreen(20, 10, 270) }, { x: -20, y: 10 });
  assert.deepEqual({ ...core.orientationToScreen(20, 10, -90) }, { x: -20, y: 10 });
});

test('angle deltas stay continuous across the 180 degree boundary', () => {
  assert.equal(core.shortestAngleDelta(-179, 179), 2);
  assert.equal(core.shortestAngleDelta(179, -179), -2);
  assert.equal(core.shortestAngleDelta(30, 10), 20);
});

test('frame timing is normalized to 60 FPS and clamped after stalls', () => {
  assert.ok(Math.abs(core.frameScaleFromDelta(1000 / 60) - 1) < 1e-12);
  assert.ok(Math.abs(core.frameScaleFromDelta(1000 / 30) - 2) < 1e-12);
  assert.equal(core.frameScaleFromDelta(0), 0.25);
  assert.equal(core.frameScaleFromDelta(1000), 2.5);
});

test('trail fading has the same decay over equivalent wall time', () => {
  assert.ok(Math.abs(core.fadeAlphaForFrame(0.15, 1) - 15) < 1e-10);
  assert.ok(Math.abs(core.fadeAlphaForFrame(0.15, 2) - 27.75) < 1e-10);
});

test('adaptive particle changes never cross configured bounds', () => {
  assert.equal(core.particleAdjustment(301, 280, 1200, 30), -21);
  assert.equal(core.particleAdjustment(280, 280, 1200, 30), 0);
  assert.equal(core.particleAdjustment(1199, 280, 1200, 60), 1);
  assert.equal(core.particleAdjustment(1200, 280, 1200, 60), 0);
  assert.equal(core.particleAdjustment(800, 280, 1200, 50), 0);
});
