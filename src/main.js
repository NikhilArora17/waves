import * as THREE from 'three';
import { Noise } from 'noisejs';

const noise = new Noise();

let scene, camera, renderer;
const lines = [];
let lineCount = 25;

// instead of segmentCount, we use dotSpacing
let dotSpacing = 7; // gap between dots in px

let width = window.innerWidth;
let height = window.innerHeight;

let sharedLeftX = -width / 1.3;
let sharedRightX = width / 1.3;
let maxDist = width / 0.5;

// === debounce + stable-viewport helpers ===
let resizeTimer = null;
let lastAppliedW = 0;
let lastAppliedH = 0;

function getViewportSize() {
  // Prefer VisualViewport when available (more accurate on mobile rotation)
  const vv = window.visualViewport;
  if (vv) return { w: Math.floor(vv.width), h: Math.floor(vv.height) };
  return { w: Math.floor(window.innerWidth), h: Math.floor(window.innerHeight) };
}

function scheduleResize(reason = 'generic') {
  // Wait a bit for orientation/viewport to settle (common on iOS)
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const { w, h } = getViewportSize();

    // guard against transient 0 values during rotation
    if (!w || !h) {
      // try again shortly until non-zero
      scheduleResize('retry-nonzero');
      return;
    }

    // avoid redundant work
    if (w === lastAppliedW && h === lastAppliedH) return;

    performResize(w, h);
  }, reason === 'orientation' ? 250 : 120); // slightly longer after orientation changes
}

function performResize(newW, newH) {
  lastAppliedW = newW;
  lastAppliedH = newH;

  width = newW;
  height = newH;

  // endpoints re-derived from new width
  sharedLeftX = -width / 1.5;   // a touch tighter on resize to keep centered feel
  sharedRightX = width / 1.5;
  maxDist = width / 0.5;

  // update camera frustum to match new viewport
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  // clamp DPR to keep performance/stability on iPad
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false); // no CSS resize here

  // If your canvas is styled via CSS to fill container, ensure container updates too
  // (Most setups already have canvas width/height:100%)
}

init();
animate();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(
    -width / 2, width / 2,
    height / 2, -height / 2,
    1, 1000
  );
  camera.position.z = 1;

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('canvas'),
    antialias: true,
    alpha: true
  });

  // initial DPR clamp for mobile
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height);
  renderer.setClearColor(0xffffff, 0.05);
  renderer.autoClear = true;

  const material = new THREE.PointsMaterial({
    color: 0x000000,
    size: 1.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.4,
    map: createCircleTexture(),
    alphaTest: 0.1,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(3); // placeholder, real size set each frame
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, material.clone());
    points.userData.index = i;
    lines.push(points);
    scene.add(points);
  }

  // --- listeners for rotation & resize ---
  window.addEventListener('resize', () => scheduleResize('resize'));
  window.addEventListener('orientationchange', () => scheduleResize('orientation'));

  // VisualViewport (iOS Safari / mobile) — fires during rotation & UI chrome changes
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => scheduleResize('vv-resize'));
  }

  // As a safety, observe canvas size changes (if wrapped in responsive container)
  const canvas = renderer.domElement;
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => scheduleResize('observer'));
    ro.observe(canvas);
  }

  // Apply an initial stable size
  scheduleResize('init');
}

function createCircleTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function animate(time) {
  requestAnimationFrame(animate);
  const t = time * 0.00032;

  // renderer.clear() is implicit when autoClear=true; keep clearColor set in init

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

    // calculate number of dots based on curve length and spacing
    const curveLength = curve.getLength();
    const pointCount = Math.max(2, Math.floor(curveLength / dotSpacing)); // guard against 0

    const curvePoints = curve.getSpacedPoints(pointCount);

    // resize buffer if needed
    const desiredCount = curvePoints.length;
    if (points.geometry.attributes.position.count !== desiredCount) {
      points.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(desiredCount * 3), 3)
      );
    }

    const positions = points.geometry.attributes.position.array;

    for (let j = 0; j < desiredCount; j++) {
      const p = curvePoints[j];
      const idx = j * 3;
      positions[idx] = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = 0;
    }

    points.geometry.attributes.position.needsUpdate = true;

    const centerIndex = Math.floor(curvePoints.length / 2);
    const cx = curvePoints[centerIndex].x;
    const distToCenter = Math.abs(cx);
    const fade = 1.0 - Math.min(distToCenter / maxDist, 1);

    points.material.opacity = 0.15 + 0.35 * Math.sin(t * 4 + lineIndex * 0.4) * fade;
  });

  renderer.render(scene, camera);
}
