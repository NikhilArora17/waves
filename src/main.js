import * as THREE from 'three';
import { Noise } from 'noisejs';

// --- Config
const EDGE_SCALE = 1.3;   // keep endpoints symmetric around X=0
const DPR_CAP    = 2;     // keep iPad framebuffer sane

// --- Globals
let scene, camera, renderer, canvas;
const lines = [];
const lineCount = 25;
let dotSpacing = 7;

let width = 1, height = 1, DPR = 1;
let sharedLeftX = -1, sharedRightX = 1, maxDist = 1;
let contextLost = false;
let resizeRaf = 0;

// Noise with fallback (in case Noise import fails on device)
const noise = (typeof Noise === 'function') ? new Noise() : {
  perlin2: (x, y) => {
    // quick hash noise fallback (not true perlin, just “jitter”)
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }
};

// ---- Boot
whenReady(() => ensureCanvas('#canvas').then(start).catch(err => {
  console.error('Canvas not found:', err);
}));

function whenReady(cb){
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cb, { once:true });
  } else cb();
}

function ensureCanvas(selector, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const now = () => document.querySelector(selector);
    const found = now();
    if (found) return resolve(found);

    const obs = new MutationObserver(() => {
      const el = now();
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(() => { obs.disconnect(); now() ? resolve(now()) : reject(new Error('timeout')); }, timeoutMs);
  });
}

function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch { return false; }
}

// ---- Start
function start(foundCanvas) {
  canvas = foundCanvas;

  if (!isWebGLAvailable()) {
    console.error('WebGL not available');
    return;
  }

  // Initial sizes
  width  = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  DPR    = Math.min(window.devicePixelRatio || 1, DPR_CAP);

  sharedLeftX  = -width / EDGE_SCALE;
  sharedRightX =  width / EDGE_SCALE;
  maxDist      =  width / 0.5;

  // Scene + camera
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(
    -width / 2, width / 2,
     height / 2, -height / 2,
     1, 1000
  );
  camera.position.z = 1;

  // Renderer
  buildRenderer();
  renderer.setSize(width, height, true);

  // Material
  const material = new THREE.PointsMaterial({
    color: 0x000000,
    size: 1.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.4,
    map: createCircleTexture(),
    alphaTest: 0.1,
    depthWrite: false,
    blending: THREE.NormalBlending 
  });

  // Lines
  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const points = new THREE.Points(geometry, material.clone());
    points.userData.index = i;
    lines.push(points);
    scene.add(points);
  }

  // Listeners
  window.addEventListener('resize', scheduleSafeResize, { passive: true });
  window.addEventListener('orientationchange', scheduleSafeResize, { passive: true });
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  requestAnimationFrame(animate);
}

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(DPR);
  renderer.setSize(width, height, true);  // sync CSS + buffer
  renderer.setClearColor(0xffffff, 0.05);
  renderer.autoClear = true;
}

function recreateRenderer() {
  try { renderer?.dispose(); } catch {}
  buildRenderer();
}

function onContextLost(e) {
  e.preventDefault();
  contextLost = true;
}

function onContextRestored() {
  contextLost = false;
  recreateRenderer();
}

function createCircleTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// ---- Debounced resize that waits for iOS to settle sizes & DPR
function scheduleSafeResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  let tries = 0, maxTries = 12;
  let lastW = 0, lastH = 0, lastDpr = 0;

  const tick = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);

    if ((w === lastW && h === lastH && dpr === lastDpr) || tries >= maxTries) {
      applyResize(w, h, dpr);
    } else {
      lastW = w; lastH = h; lastDpr = dpr;
      tries++;
      resizeRaf = requestAnimationFrame(tick);
    }
  };
  resizeRaf = requestAnimationFrame(tick);
}

function applyResize(newW, newH, newDpr) {
  width  = newW;
  height = newH;
  DPR    = newDpr;

  sharedLeftX  = -width / EDGE_SCALE;
  sharedRightX =  width / EDGE_SCALE;
  maxDist      =  width / 0.5;

  camera.left   = -width / 2;
  camera.right  =  width / 2;
  camera.top    =  height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(DPR);
  renderer.setSize(width, height, true); // update CSS + buffer
}

// ---- Loop
function animate(time) {
  requestAnimationFrame(animate);
  if (!renderer || contextLost) return;

  const t = time * 0.00032;

  lines.forEach((points, lineIndex) => {
    const baseY = 0;
    const amplitude = 150 + lineIndex * 30;

    const phaseShift = lineIndex * 0.2;
    const verticalOffset = Math.sin(t * 2 + phaseShift) * 12;
    const horizontalJitter = Math.sin(t * 1.5 + phaseShift) * 5;

    const p0 = new THREE.Vector3(sharedLeftX + horizontalJitter, baseY + verticalOffset, 0);
    const p4 = new THREE.Vector3(sharedRightX + horizontalJitter, baseY + verticalOffset, 0);

    const midPoints = [];
    for (let j = 0; j < 3; j++) {
      const x = sharedLeftX + ((j + 1) / 4) * (sharedRightX - sharedLeftX) + horizontalJitter;
      const y = baseY + verticalOffset + noise.perlin2(j * (0.4 + lineIndex * 0.05), t + lineIndex * 0.07) * amplitude;
      midPoints.push(new THREE.Vector3(x, y, 0));
    }

    const curve = new THREE.CatmullRomCurve3([p0, ...midPoints, p4]);

    const curveLength = Math.max(1, curve.getLength());
    const pointCount  = Math.max(2, Math.floor(curveLength / dotSpacing));
    const curvePoints = curve.getSpacedPoints(pointCount);

    const attr = points.geometry.getAttribute('position');
    if (!attr || attr.count !== curvePoints.length) {
      points.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(curvePoints.length * 3), 3)
      );
    }

    const positions = points.geometry.attributes.position.array;
    for (let j = 0; j < curvePoints.length; j++) {
      const p = curvePoints[j];
      const idx = j * 3;
      positions[idx]     = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = 0;
    }
    points.geometry.attributes.position.needsUpdate = true;

    const centerIndex = Math.floor(curvePoints.length / 2);
    const cx = curvePoints[centerIndex]?.x ?? 0;
    const distToCenter = Math.abs(cx);
    const fade = 1.0 - Math.min(distToCenter / maxDist, 1);

    points.material.opacity = 0.15 + 0.35 * Math.sin(t * 4 + lineIndex * 0.4) * fade;
  });

  renderer.render(scene, camera);
}
