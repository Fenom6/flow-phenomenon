'use strict';

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const prefersReducedMotion = reducedMotionQuery.matches;

const INITIAL_PARTICLES = prefersReducedMotion ? 320 : 800;
const MIN_PARTICLES = prefersReducedMotion ? 180 : 280;
const MAX_PARTICLES = prefersReducedMotion ? 480 : 1200;
const SENSOR_EVENT_TIMEOUT_MS = 2800;
const SENSOR_STALE_MS = 2200;
const BURST_COOLDOWN_MS = 650;
const HELP_VISIBLE_MS = 8000;
const GRAVITY_STRENGTH = 0.055;

const {
  clamp,
  fadeAlphaForFrame,
  frameScaleFromDelta,
  orientationToScreen,
  particleAdjustment,
  shortestAngleDelta,
} = window.FlowCore || {};

const palettes = [
  { name: '深海', baseHue: 195, hueRange: 50, sat: 80, bri: 100 },
  { name: 'オーロラ', baseHue: 120, hueRange: 140, sat: 75, bri: 95 },
  { name: '焔', baseHue: 10, hueRange: 40, sat: 90, bri: 100 },
  { name: '月光', baseHue: 220, hueRange: 25, sat: 25, bri: 100 },
];

let particles = [];
let noiseScale = 0.005;
let timeOffset = 0;
let paletteIndex = 0;
let paletteBlend = 1;
let burstEnergy = 0;
let lastBurstAt = -Infinity;

let started = false;
let setupComplete = false;
let startInProgress = false;
let userPaused = false;
let baseInteractionMode = 'touch';

let orientationListenerBound = false;
let motionListenerBound = false;
let permissionRequestInFlight = false;
let isSensorActive = false;
let lastOrientationAt = 0;
let sensorBaseline = null;
let sensorGravity = { x: 0, y: 0 };
let sensorTimeoutId = null;
let lastMotionSample = null;

let performanceFps = 60;
let lastPerformanceCheckAt = 0;
let resizeTimer = null;
let hintTimer = null;
let hintHideTimer = null;

const activePointers = new Map();
const pointerStarts = new Map();
let multiTouchGesture = false;
let lastTap = null;
let finePointer = { x: 0, y: 0, seen: false };
let lastPointerType = 'mouse';

const ui = {};

function markBootFailure(message) {
  const button = document.getElementById('start-btn');
  const label = document.getElementById('start-label');
  const status = document.getElementById('start-status');
  if (button) button.disabled = true;
  if (label) label.textContent = '起動できません';
  if (status) status.textContent = message;
}

function patchP5SensorGuards() {
  const prototype = window.p5 && window.p5.prototype;
  if (!prototype) return;

  const originalOrientationHandler = prototype._ondeviceorientation;
  if (typeof originalOrientationHandler === 'function' && !originalOrientationHandler.__flowEventIsolation) {
    function isolatedDeviceOrientation(event) {
      const isolatedEvent = {
        alpha: event && event.alpha,
        beta: event && event.beta,
        gamma: event && event.gamma,
      };
      return originalOrientationHandler.call(this, isolatedEvent);
    }

    isolatedDeviceOrientation.__flowEventIsolation = true;
    prototype._ondeviceorientation = isolatedDeviceOrientation;
  }

  const originalMotionHandler = prototype._ondevicemotion;
  if (typeof originalMotionHandler !== 'function' || originalMotionHandler.__flowNullGuard) return;

  function guardedDeviceMotion(event) {
    const acceleration = event && event.acceleration;
    if (!acceleration || ![acceleration.x, acceleration.y, acceleration.z].every(Number.isFinite)) {
      return undefined;
    }
    return originalMotionHandler.call(this, event);
  }

  guardedDeviceMotion.__flowNullGuard = true;
  prototype._ondevicemotion = guardedDeviceMotion;
}

if (typeof window.p5 === 'undefined' || !window.FlowCore) {
  markBootFailure('必要な描画プログラムを読み込めませんでした。ページを再読み込みしてください。');
} else {
  patchP5SensorGuards();
}

window.addEventListener('error', () => {
  if (!setupComplete) {
    markBootFailure('初期化中に問題が起きました。ページを再読み込みしてください。');
  }
});

window.addEventListener('load', () => {
  const canUseSecureFeatures = window.isSecureContext
    || location.protocol === 'https:'
    || location.hostname === 'localhost'
    || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && canUseSecureFeatures) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // The artwork still works without offline caching.
    });
  }
});

function setup() {
  if (typeof window.p5 === 'undefined' || !window.FlowCore) return;

  const densityCap = prefersReducedMotion ? 1 : 1.5;
  pixelDensity(Math.min(window.devicePixelRatio || 1, densityCap));

  const renderer = createCanvas(windowWidth, windowHeight);
  renderer.parent('canvas-host');
  renderer.attribute('role', 'img');
  renderer.attribute('aria-label', '端末の傾きやポインターに反応する有機的な粒子の流れ');
  renderer.attribute('tabindex', '0');
  renderer.attribute('aria-keyshortcuts', 'Space 1 2 3 4 P H ?');

  colorMode(HSB, 360, 100, 100, 100);
  blendMode(ADD);

  for (let i = 0; i < INITIAL_PARTICLES; i += 1) {
    particles.push(new Particle());
  }

  cacheUi();
  ui.canvas = renderer.elt;
  bindUiEvents();
  bindPointerEvents();
  bindLifecycleEvents();
  updatePaletteUi();
  setBaseInteractionMode('touch', false);

  ui.startButton.disabled = false;
  ui.startLabel.textContent = '体験をはじめる';
  ui.startStatus.textContent = '対応端末では開始時にセンサー利用を確認します。許可しなくてもタッチ／マウスで続けられます。';
  setupComplete = true;
  noLoop();
}

function cacheUi() {
  ui.canvasHost = document.getElementById('canvas-host');
  ui.intro = document.getElementById('intro');
  ui.startButton = document.getElementById('start-btn');
  ui.startLabel = document.getElementById('start-label');
  ui.startStatus = document.getElementById('start-status');
  ui.hud = document.getElementById('hud');
  ui.modeButton = document.getElementById('mode-btn');
  ui.modeLabel = document.getElementById('mode-label');
  ui.helpButton = document.getElementById('help-btn');
  ui.hint = document.getElementById('hint');
  ui.defaultHintMarkup = ui.hint.innerHTML;
  ui.controls = document.getElementById('controls');
  ui.paletteButton = document.getElementById('palette-btn');
  ui.paletteName = document.getElementById('palette-name');
  ui.burstButton = document.getElementById('burst-btn');
  ui.pauseButton = document.getElementById('pause-btn');
  ui.pauseLabel = document.getElementById('pause-label');
  ui.announcer = document.getElementById('announcer');
}

function bindUiEvents() {
  ui.startButton.addEventListener('click', startExperience);
  ui.paletteButton.addEventListener('click', cyclePalette);
  ui.burstButton.addEventListener('click', burst);
  ui.pauseButton.addEventListener('click', togglePause);
  ui.helpButton.addEventListener('click', toggleHint);
  ui.modeButton.addEventListener('click', handleModeButton);
}

function bindPointerEvents() {
  ui.canvasHost.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerEnd, { passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { passive: true });
  ui.canvasHost.addEventListener('dblclick', (event) => {
    if (started && lastPointerType !== 'touch') cyclePalette();
  });
}

function bindLifecycleEvents() {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', clearPointerState, { passive: true });
  window.addEventListener('orientationchange', handleScreenOrientationChange, { passive: true });
  if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
    screen.orientation.addEventListener('change', handleScreenOrientationChange);
  }
}

async function startExperience() {
  if (started || startInProgress || !setupComplete) return;

  startInProgress = true;
  ui.startButton.disabled = true;
  ui.startLabel.textContent = 'センサーを確認中…';
  ui.startStatus.textContent = '許可しない場合も、タッチ／マウスモードでそのまま続けられます。';

  const sensorResult = await requestSensorAccess();

  started = true;
  startInProgress = false;
  resetPerformanceWindow();
  ui.intro.classList.add('is-hidden');
  ui.hud.classList.remove('is-hidden');
  ui.controls.classList.remove('is-hidden');
  if (!document.hidden && !isLooping()) loop();
  requestAnimationFrame(() => ui.canvas.focus({ preventScroll: true }));

  if (sensorResult.orientationAllowed) {
    if (isSensorActive) {
      setBaseInteractionMode('sensor');
    } else {
      setBaseInteractionMode('pending');
      armSensorTimeout();
    }
    showHint();
  } else {
    setBaseInteractionMode('touch');
    const reason = sensorResult.insecure
      ? '傾きセンサーにはHTTPSが必要です。タッチ／マウスモードで続行します。'
      : 'センサーを利用できないため、タッチ／マウスモードで続行します。上のモード表示から再確認できます。';
    showHint(reason);
  }
}

function beginPermissionRequest(EventType) {
  if (!EventType) return Promise.resolve('unsupported');
  if (typeof EventType.requestPermission !== 'function') return Promise.resolve('not-required');

  try {
    return Promise.resolve(EventType.requestPermission())
      .then((value) => (value === 'granted' ? 'granted' : 'denied'))
      .catch(() => 'error');
  } catch {
    return Promise.resolve('error');
  }
}

async function requestSensorAccess() {
  if (permissionRequestInFlight) {
    return { orientationAllowed: orientationListenerBound, motionAllowed: motionListenerBound, insecure: false };
  }

  permissionRequestInFlight = true;
  setBaseInteractionMode('pending');
  if (ui.modeButton) ui.modeButton.disabled = true;

  const localSecureException = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const insecure = !window.isSecureContext && location.protocol !== 'https:' && !localSecureException;

  let orientationPermission = 'insecure';
  let motionPermission = 'insecure';

  if (!insecure) {
    // Both permission calls are created before awaiting so iOS sees the same user activation.
    const orientationRequest = beginPermissionRequest(window.DeviceOrientationEvent);
    const motionRequest = beginPermissionRequest(window.DeviceMotionEvent);
    [orientationPermission, motionPermission] = await Promise.all([orientationRequest, motionRequest]);
  }

  const orientationAllowed = orientationPermission === 'granted' || orientationPermission === 'not-required';
  const motionAllowed = motionPermission === 'granted' || motionPermission === 'not-required';

  if (orientationAllowed) {
    isSensorActive = false;
    sensorBaseline = null;
    sensorGravity = { x: 0, y: 0 };
  }

  if (orientationAllowed && !orientationListenerBound && window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
    orientationListenerBound = true;
  }

  if (motionAllowed && !motionListenerBound && window.DeviceMotionEvent) {
    window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
    motionListenerBound = true;
  }

  permissionRequestInFlight = false;
  if (ui.modeButton) ui.modeButton.disabled = false;

  if (orientationAllowed) {
    setBaseInteractionMode('pending');
    armSensorTimeout();
  } else {
    setBaseInteractionMode('touch');
  }

  return { orientationAllowed, motionAllowed, insecure };
}

async function handleModeButton() {
  if (permissionRequestInFlight) return;

  if (isSensorActive) {
    sensorBaseline = null;
    sensorGravity = { x: 0, y: 0 };
    setBaseInteractionMode('pending');
    armSensorTimeout();
    showHint('現在の持ち方を中立位置として再調整します。');
    return;
  }

  const result = await requestSensorAccess();
  if (result.orientationAllowed) {
    showHint('センサー入力を待っています。端末をゆっくり傾けてください。');
  } else if (result.insecure) {
    showHint('傾きセンサーはHTTPSまたはlocalhostで利用できます。タッチ操作は引き続き使えます。');
  } else {
    showHint('センサーを利用できません。ブラウザ設定を確認するか、タッチ操作でお楽しみください。');
  }
}

function onDeviceOrientation(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;

  const oriented = orientationToScreen(event.beta, event.gamma, getScreenAngle());
  if (!sensorBaseline) {
    sensorBaseline = oriented;
  }

  const deltaX = clamp(shortestAngleDelta(oriented.x, sensorBaseline.x), -45, 45);
  const deltaY = clamp(shortestAngleDelta(oriented.y, sensorBaseline.y), -45, 45);
  const targetX = clamp(deltaX * GRAVITY_STRENGTH, -2.5, 2.5);
  const targetY = clamp(deltaY * GRAVITY_STRENGTH, -2.5, 2.5);

  sensorGravity.x += (targetX - sensorGravity.x) * 0.18;
  sensorGravity.y += (targetY - sensorGravity.y) * 0.18;
  lastOrientationAt = performance.now();

  if (!isSensorActive) {
    isSensorActive = true;
    clearTimeout(sensorTimeoutId);
    setBaseInteractionMode('sensor');
    announce('傾きセンサーが有効になりました。');
  }
}

function getScreenAngle() {
  if (screen.orientation && Number.isFinite(screen.orientation.angle)) {
    return screen.orientation.angle;
  }
  return Number.isFinite(window.orientation) ? window.orientation : 0;
}

function onDeviceMotion(event) {
  const direct = event.acceleration;
  if (direct && [direct.x, direct.y, direct.z].every(Number.isFinite)) {
    const magnitude = Math.hypot(direct.x, direct.y, direct.z);
    if (magnitude > 12) burst();
    return;
  }

  const gravity = event.accelerationIncludingGravity;
  if (!gravity || ![gravity.x, gravity.y, gravity.z].every(Number.isFinite)) return;

  if (lastMotionSample) {
    const delta = Math.abs(gravity.x - lastMotionSample.x)
      + Math.abs(gravity.y - lastMotionSample.y)
      + Math.abs(gravity.z - lastMotionSample.z);
    if (delta > 25) burst();
  }
  lastMotionSample = { x: gravity.x, y: gravity.y, z: gravity.z };
}

function armSensorTimeout() {
  clearTimeout(sensorTimeoutId);
  sensorTimeoutId = window.setTimeout(() => {
    if (!isSensorActive) {
      setBaseInteractionMode('touch');
      if (started) {
        showHint('センサー値を受信できないため、タッチ／マウスモードに切り替えました。');
      }
    }
  }, SENSOR_EVENT_TIMEOUT_MS);
}

function updateSensorFreshness(now) {
  if (isSensorActive && now - lastOrientationAt > SENSOR_STALE_MS) {
    isSensorActive = false;
    sensorGravity = { x: 0, y: 0 };
    setBaseInteractionMode('touch');
  }
}

function handleScreenOrientationChange() {
  sensorBaseline = null;
  sensorGravity = { x: 0, y: 0 };
  lastMotionSample = null;
  if (orientationListenerBound) {
    isSensorActive = false;
    setBaseInteractionMode('pending');
    armSensorTimeout();
  }
}

function handleVisibilityChange() {
  lastMotionSample = null;
  if (document.hidden) {
    clearPointerState();
    if (typeof isLooping === 'function' && isLooping()) noLoop();
    return;
  }

  if (orientationListenerBound) {
    isSensorActive = false;
    sensorBaseline = null;
    sensorGravity = { x: 0, y: 0 };
    setBaseInteractionMode('pending');
    armSensorTimeout();
  }

  if (!userPaused && typeof isLooping === 'function' && !isLooping()) loop();
  if (!userPaused) resetPerformanceWindow();
}

function setBaseInteractionMode(mode, shouldAnnounce = true) {
  if (baseInteractionMode === mode && ui.modeButton && ui.modeButton.dataset.mode === mode) return;
  baseInteractionMode = mode;
  updateModeUi(shouldAnnounce);
}

function updateModeUi(shouldAnnounce = true) {
  if (!ui.modeButton) return;

  const visibleMode = userPaused ? 'paused' : baseInteractionMode;
  const modes = {
    pending: { label: 'SENSOR CHECK', description: 'センサー入力を確認中' },
    sensor: { label: 'TILT MODE', description: '傾きセンサーが有効' },
    touch: { label: 'TOUCH MODE', description: 'タッチ／マウス操作モード' },
    paused: { label: 'PAUSED', description: 'アニメーションを一時停止中' },
  };
  const state = modes[visibleMode];

  ui.modeButton.dataset.mode = visibleMode;
  ui.modeLabel.textContent = state.label;
  ui.modeButton.setAttribute('aria-label', `${state.description}。押すと${visibleMode === 'sensor' ? '中立位置を再調整' : 'センサーを再確認'}します`);
  if (shouldAnnounce && started) announce(state.description);
}

function announce(message) {
  if (!ui.announcer || ui.announcer.textContent === message) return;
  ui.announcer.textContent = message;
}

function showHint(message = '') {
  if (!ui.hint) return;
  clearTimeout(hintTimer);
  clearTimeout(hintHideTimer);

  if (message) {
    ui.hint.textContent = message;
    announce(message);
  } else {
    ui.hint.innerHTML = ui.defaultHintMarkup;
    announce('操作方法。傾けるかドラッグで流れを動かし、ダブルタップで色を変え、シェイクで粒子をバーストさせます。');
  }

  ui.hint.hidden = false;
  ui.hint.setAttribute('aria-hidden', 'false');
  ui.helpButton.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => ui.hint.classList.add('is-visible'));

  hintTimer = window.setTimeout(hideHint, HELP_VISIBLE_MS);
}

function toggleHint() {
  if (ui.hint.hidden || ui.hint.getAttribute('aria-hidden') === 'true') {
    showHint();
  } else {
    hideHint();
  }
}

function hideHint() {
  if (!ui.hint) return;
  clearTimeout(hintTimer);
  clearTimeout(hintHideTimer);
  ui.hint.classList.remove('is-visible');
  ui.hint.setAttribute('aria-hidden', 'true');
  ui.helpButton.setAttribute('aria-expanded', 'false');
  hintHideTimer = window.setTimeout(() => {
    ui.hint.hidden = true;
  }, 240);
}

function onPointerDown(event) {
  if (!started) return;
  lastPointerType = event.pointerType || 'mouse';
  const point = { x: event.clientX, y: event.clientY, type: event.pointerType };
  activePointers.set(event.pointerId, point);
  pointerStarts.set(event.pointerId, { ...point, time: performance.now(), moved: false });
  if (event.pointerType === 'touch' && countActiveTouchPointers() > 1) multiTouchGesture = true;
}

function onPointerMove(event) {
  if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
    finePointer = { x: event.clientX, y: event.clientY, seen: true };
  }

  if (!activePointers.has(event.pointerId)) return;
  if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && event.buttons === 0) {
    onPointerCancel(event);
    return;
  }
  const point = activePointers.get(event.pointerId);
  point.x = event.clientX;
  point.y = event.clientY;

  const start = pointerStarts.get(event.pointerId);
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 18) {
    start.moved = true;
  }
}

function onPointerEnd(event) {
  const start = pointerStarts.get(event.pointerId);
  activePointers.delete(event.pointerId);
  pointerStarts.delete(event.pointerId);

  if (event.pointerType === 'touch' && start && !start.moved && !multiTouchGesture) {
    registerTouchTap(event.clientX, event.clientY);
  }

  if (countActiveTouchPointers() === 0) multiTouchGesture = false;
}

function onPointerCancel(event) {
  activePointers.delete(event.pointerId);
  pointerStarts.delete(event.pointerId);
  lastTap = null;
  if (countActiveTouchPointers() === 0) multiTouchGesture = false;
}

function clearPointerState() {
  activePointers.clear();
  pointerStarts.clear();
  multiTouchGesture = false;
  lastTap = null;
}

function countActiveTouchPointers() {
  let count = 0;
  for (const point of activePointers.values()) {
    if (point.type === 'touch') count += 1;
  }
  return count;
}

function registerTouchTap(x, y) {
  const now = performance.now();
  if (lastTap && now - lastTap.time < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 48) {
    lastTap = null;
    cyclePalette();
    return;
  }
  lastTap = { x, y, time: now };
}

function cyclePalette() {
  paletteIndex = (paletteIndex + 1) % palettes.length;
  paletteBlend = 0;
  updatePaletteUi();
  announce(`カラーパレットを${palettes[paletteIndex].name}に変更しました。`);
}

function updatePaletteUi() {
  if (!ui.paletteButton) return;
  const name = palettes[paletteIndex].name;
  ui.paletteName.textContent = name;
  ui.paletteButton.setAttribute('aria-label', `色を変える。現在は${name}`);
}

function burst() {
  const now = performance.now();
  if (now - lastBurstAt < BURST_COOLDOWN_MS) return;
  lastBurstAt = now;
  burstEnergy = 1;

  for (const particle of particles) {
    let dx = particle.pos.x - width / 2;
    let dy = particle.pos.y - height / 2;
    let magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.001) {
      const angle = random(TWO_PI);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      magnitude = 1;
    }
    const impulse = random(prefersReducedMotion ? 5 : 8, prefersReducedMotion ? 9 : 16);
    particle.vel.x += (dx / magnitude) * impulse;
    particle.vel.y += (dy / magnitude) * impulse;
    particle.prev.set(particle.pos);
  }

  announce('粒子をバーストさせました。');
}

function togglePause() {
  userPaused = !userPaused;
  ui.pauseButton.setAttribute('aria-pressed', String(userPaused));
  ui.pauseLabel.textContent = userPaused ? '再開' : '一時停止';
  updateModeUi();

  if (userPaused) {
    if (isLooping()) noLoop();
  } else if (!document.hidden && !isLooping()) {
    resetPerformanceWindow();
    loop();
  }
}

function keyPressed(event) {
  if (!started) return undefined;
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return undefined;

  if (key === 'Escape') {
    if (ui.helpButton.getAttribute('aria-expanded') === 'true') hideHint();
    return false;
  }

  if ((activeTag === 'BUTTON' || activeTag === 'A') && (key === ' ' || key === 'Enter')) {
    return undefined;
  }

  if (key === ' ') {
    if (event) event.preventDefault();
    burst();
    return false;
  }

  const number = Number.parseInt(key, 10);
  if (number >= 1 && number <= palettes.length) {
    paletteIndex = number - 1;
    paletteBlend = 0;
    updatePaletteUi();
    announce(`カラーパレットを${palettes[paletteIndex].name}に変更しました。`);
    return false;
  }

  if (key === 'p' || key === 'P') {
    togglePause();
    return false;
  }

  if (key === 'h' || key === 'H' || key === '?') {
    toggleHint();
    return false;
  }

  return undefined;
}

function draw() {
  if (!window.FlowCore) {
    noLoop();
    return;
  }

  const frameScale = frameScaleFromDelta(deltaTime);
  const baseFade = prefersReducedMotion ? 0.24 : 0.15;
  const fadeAlpha = fadeAlphaForFrame(baseFade, frameScale);

  blendMode(BLEND);
  background(0, 0, burstEnergy * (prefersReducedMotion ? 4 : 12), fadeAlpha);
  blendMode(ADD);

  burstEnergy = Math.max(0, burstEnergy - 0.03 * frameScale);
  paletteBlend = Math.min(1, paletteBlend + 0.02 * frameScale);
  timeOffset += (prefersReducedMotion ? 0.0018 : 0.005) * frameScale;

  const now = performance.now();
  updateSensorFreshness(now);

  let gravityX = 0;
  let gravityY = 0;
  if (isSensorActive) {
    gravityX = sensorGravity.x;
    gravityY = sensorGravity.y;
  } else if (finePointer.seen) {
    gravityX = (finePointer.x - width / 2) * 0.002;
    gravityY = (finePointer.y - height / 2) * 0.002;
  }

  const pointers = Array.from(activePointers.values());
  for (const particle of particles) {
    particle.followField(noiseScale, timeOffset, frameScale);
    particle.applyForce(gravityX * frameScale, gravityY * frameScale);
    particle.repelFromPointers(pointers, frameScale);
    particle.update(frameScale);
    particle.edges();
    particle.show();
  }

  adaptPerformance(now);
}

function adaptPerformance(now) {
  if (!started || userPaused) return;

  const elapsedSeconds = clamp(deltaTime, 1, 250) / 1000;
  const instantaneousFps = 1 / elapsedSeconds;
  const smoothing = 1 - Math.exp(-elapsedSeconds / 1.8);
  performanceFps += (instantaneousFps - performanceFps) * smoothing;

  if (!lastPerformanceCheckAt) {
    lastPerformanceCheckAt = now;
    return;
  }
  if (now - lastPerformanceCheckAt < 3000) return;
  lastPerformanceCheckAt = now;

  const adjustment = particleAdjustment(particles.length, MIN_PARTICLES, MAX_PARTICLES, performanceFps);
  if (adjustment < 0) {
    particles.splice(0, -adjustment);
  } else if (adjustment > 0) {
    for (let i = 0; i < adjustment; i += 1) particles.push(new Particle());
  }
}

function resetPerformanceWindow() {
  performanceFps = 60;
  lastPerformanceCheckAt = performance.now();
}

class Particle {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.prev = this.pos.copy();
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.maxSpeed = prefersReducedMotion ? random(1.2, 2.3) : random(2, 4);
    this.hueOffset = random(-1, 1);
    this.size = random(1, 3);
  }

  followField(scale, time, frameScale) {
    const angle = noise(this.pos.x * scale, this.pos.y * scale, time) * TWO_PI * 2;
    const strength = (prefersReducedMotion ? 0.24 : 0.5) * frameScale;
    this.acc.x += Math.cos(angle) * strength;
    this.acc.y += Math.sin(angle) * strength;
  }

  applyForce(x, y) {
    this.acc.x += x;
    this.acc.y += y;
  }

  repelFromPointers(pointers, frameScale) {
    for (const pointer of pointers) {
      let dx = this.pos.x - pointer.x;
      let dy = this.pos.y - pointer.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= 22500) continue;

      let distance = Math.sqrt(distanceSquared);
      if (distance < 0.001) {
        const angle = random(TWO_PI);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }

      const strength = (3 - (distance / 150) * 2.5) * frameScale;
      this.acc.x += (dx / distance) * strength;
      this.acc.y += (dy / distance) * strength;
    }
  }

  update(frameScale) {
    this.prev.set(this.pos);
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed + burstEnergy * (prefersReducedMotion ? 7 : 12));
    this.pos.x += this.vel.x * frameScale;
    this.pos.y += this.vel.y * frameScale;
    this.acc.mult(0);
  }

  show() {
    const palette = palettes[paletteIndex];
    const heading = this.vel.heading();
    let hue = palette.baseHue + (heading / PI) * palette.hueRange * 0.5 + this.hueOffset * 15;
    hue = (hue + 360) % 360;

    const speedRatio = Math.min(1.5, this.vel.mag() / this.maxSpeed);
    const alpha = (30 + speedRatio * 45) * paletteBlend;

    stroke(hue, palette.sat, palette.bri, alpha);
    strokeWeight(this.size);
    line(this.prev.x, this.prev.y, this.pos.x, this.pos.y);
  }

  edges() {
    let warped = false;
    if (this.pos.x > width) { this.pos.x = 0; warped = true; }
    if (this.pos.x < 0) { this.pos.x = width; warped = true; }
    if (this.pos.y > height) { this.pos.y = 0; warped = true; }
    if (this.pos.y < 0) { this.pos.y = height; warped = true; }
    if (warped) this.prev.set(this.pos);
  }
}

function windowResized() {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const previousWidth = Math.max(width, 1);
    const previousHeight = Math.max(height, 1);
    resizeCanvas(windowWidth, windowHeight);

    for (const particle of particles) {
      particle.pos.x = (particle.pos.x / previousWidth) * width;
      particle.pos.y = (particle.pos.y / previousHeight) * height;
      particle.prev.set(particle.pos);
    }

    resetPerformanceWindow();
  }, 160);
}
