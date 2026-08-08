(function exposeFlowCore(root) {
  'use strict';

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeScreenAngle(angle) {
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  }

  function orientationToScreen(beta, gamma, angle) {
    const normalizedAngle = normalizeScreenAngle(angle);
    if (normalizedAngle === 90) return { x: beta, y: -gamma };
    if (normalizedAngle === 180) return { x: -gamma, y: -beta };
    if (normalizedAngle === 270) return { x: -beta, y: gamma };
    return { x: gamma, y: beta };
  }

  function shortestAngleDelta(value, baseline) {
    return ((value - baseline + 540) % 360) - 180;
  }

  function frameScaleFromDelta(deltaMilliseconds) {
    return clamp(deltaMilliseconds / (1000 / 60), 0.25, 2.5);
  }

  function fadeAlphaForFrame(baseFade, frameScale) {
    return 100 * (1 - Math.pow(1 - baseFade, frameScale));
  }

  function particleAdjustment(current, minimum, maximum, fps) {
    if (fps < 43 && current > minimum) {
      return -Math.min(60, current - minimum);
    }
    if (fps > 57 && current < maximum) {
      return Math.min(30, maximum - current);
    }
    return 0;
  }

  root.FlowCore = Object.freeze({
    clamp,
    fadeAlphaForFrame,
    frameScaleFromDelta,
    normalizeScreenAngle,
    orientationToScreen,
    particleAdjustment,
    shortestAngleDelta,
  });
}(globalThis));
