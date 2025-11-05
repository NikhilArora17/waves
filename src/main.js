import * as THREE from 'three';
import { Noise } from 'noisejs';

const noise = new Noise();

let scene, camera, renderer;
const lines = [];
let lineCount = 25;
let dotSpacing = 7;

let width = 0, height = 0;
let sharedLeftX = 0, sharedRightX = 0, maxDist = 0;

let resizeTimer = null;
let lastAppliedW = -1, lastAppliedH = -1;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const DPR_CLAMP = isIOS ? 1.25 : 1.75;

// ---- DOM READY ----
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

function start() {
  const canvas = document.getElementById('canvas');
  if (!canvas) {
    console.error('Canvas #canvas not found');
    return;
  }
  init(canvas);
  scheduleResize('init');
  animate(0);
}

function getViewportSize() {
  const vv = window.visualViewport;
  if (vv) return { w: Math.floor(vv.width), h: Math.floor(vv.height) };
  return { w: Math.floor(window.innerWidth), h: Math.floor(window.innerHeight) };
}

function scheduleResize(reason = 'generic') {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const { w, h } = getViewportSize();
    if (!w || !h) { scheduleResize('retry'); return; }
    if (w === lastAppliedW && h === lastAppliedH) return;
    performResize(w, h);
  }, reason === 'orientation' ? 250 : 120);
}

function performResize(newW, newH) {
  lastAppliedW = width = newW;
  lastAppliedH = height = newH;

  sharedLeftX  = -width / 1.5;
  sharedRightX =  width / 1.5;
  maxDist      =  width / 0.5;

  camera.left   = -width / 2;
  camera.right  =  width / 2;
  camera.top    =  height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CLAMP));
  renderer.setSize(width, height, false);

  // Precompute the worst-case point count for current width and update all line buffers once
  const approxCount = Math.max(2, Math.ceil((sharedRightX - sharedLeftX) / dotSpacing) + 32);
  lines.forEach(p => ensureBufferSize(p.geometry, approxCount));
}

function init(canvas) {
  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
  camera.position.z = 1;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CLAMP));
  renderer.setSize(2, 2, false);
  renderer.setClearColor(0xffffff, 1);
  renderer.autoClear = true;

  const material = new THREE.PointsMaterial({
    color: 0x000000,
    size: 1.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.4,
    map: createCircleTexture(),
    depthWrite: false,
    // alphaTest removed; iOS + additive + low opacity can look clipped
    blending: THREE.NormalBlending
  });

  // Pre-create line objects with a conservative buffer; will be grown on first resize
  const initialPoints = 64;
  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(initialPoints * 3), 3));
    geometry.setDrawRange(0, 0);
    const points = new THREE.Points(geometry, material.clone());
    points.userData.index = i;
    lines.push(points);
    scene.add(points);
  }

  // Listeners (avoid observing canvas itself)
  window.addEventListener('resize', () => scheduleResize('resize'));
  window.addEventListener('orientationchange', () => scheduleResize('orientation'));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => scheduleResize('vv'));
  }

  // Context loss safety on iOS
  const gl = renderer.getContext();
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('WebGL context lost');
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('WebGL context restored');
    scheduleResize('restored');
  }, false);
}

function ensureBufferSize(geometry, desiredCount) {
  const attr = geometry.getAttribute('position');
  if (!attr || attr.count < desiredCount) {
    const nextSize = Math.max(desiredCount, attr ? attr.count * 2 : 128);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nextSize * 3), 3));
  }
}

function createCircleTexture() {
  const size = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,size,size);
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
  ctx.fillStyle = '#000';
  ctx.fill();
  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter; // safer on iOS
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function animate(time) {
  requestAnimationFrame(animate);
  const t = time * 0.00032;

  const span = (sharedRightX - sharedLeftX);
  const approxCount = Math.max(2, Math.floor(span / dotSpacing)); // cheap estimate

  lines.forEach((points, lineIndex) => {
    const baseY = 0;
    const amplitude = 150 + lineIndex * 30;

    const phaseShift = lineIndex * 0.2;
    const verticalOffset = Math.sin(t * 2 + phaseShift) * 12;
    const horizontalJitter = Math.sin(t * 1.5 + phaseShift) * 5;

    const p0 = new THREE.Vector3(sharedLeftX + horizontalJitter, baseY + verticalOffset, 0);
    const p4 = new THREE.Vector3(sharedRightX + horizontalJitter, baseY + verticalOffset, 0);

    const mid = [];
    for (let j = 0; j < 3; j++) {
      const x = sharedLeftX + ((j + 1) / 4) * span + horizontalJitter;
      const y = baseY + verticalOffset + noise.perlin2(j * (0.4 + lineIndex * 0.05), t + lineIndex * 0.07) * amplitude;
      mid.push(new THREE.Vector3(x, y, 0));
    }

    const curve = new THREE.CatmullRomCurve3([p0, ...mid, p4]);

    // sample with fixed step (no getLength allocations)
    const positions = points.geometry.attributes.position.array;
    ensureBufferSize(points.geometry, approxCount);
    let write = 0;
    for (let k = 0; k < approxCount; k++) {
      const u = k / (approxCount - 1);
      const p = curve.getPoint(u);
      positions[write++] = p.x;
      positions[write++] = p.y;
      positions[write++] = 0;
    }

    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.setDrawRange(0, approxCount);

    // center fade
    const cx = 0; // orthographic center x
    const distToCenter = Math.abs((mid[1]?.x ?? 0) - cx);
    const fade = 1.0 - Math.min(distToCenter / maxDist, 1);
    points.material.opacity = 0.25 * fade; // simpler, stable on iOS
  });

  renderer.render(scene, camera);
}
