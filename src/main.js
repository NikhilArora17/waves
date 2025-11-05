import * as THREE from 'three';
import { Noise } from 'noisejs';

const noise = new Noise();

// ---- constants (visuals unchanged)
const EDGE_SCALE = 1.3;   // same left/right factor as your init
const DPR_CAP = 2;        // tame iPad framebuffer

let scene, camera, renderer, canvas;
const lines = [];
let lineCount = 25;
let dotSpacing = 7;       // as before

let width = 1, height = 1, DPR = 1;
let sharedLeftX = -1, sharedRightX = 1, maxDist = 1;

let contextLost = false;
let resizeRaf = 0;

// Start once DOM & canvas are ready (doesn't change visuals)
whenReady(() => ensureCanvas('#canvas').then(start));

function whenReady(cb){
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cb, { once:true });
  } else cb();
}

function ensureCanvas(sel, timeoutMs = 3000){
  return new Promise((resolve, reject) => {
    const fn = () => document.querySelector(sel);
    if (fn()) return resolve(fn());
    const obs = new MutationObserver(() => { if (fn()) { obs.disconnect(); resolve(fn()); } });
    obs.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(() => { obs.disconnect(); fn() ? resolve(fn()) : reject(new Error('canvas not found')); }, timeoutMs);
  });
}

function start(foundCanvas){
  canvas = foundCanvas;

  // sizes
  width  = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  DPR    = Math.min(window.devicePixelRatio || 1, DPR_CAP);

  sharedLeftX  = -width / EDGE_SCALE;
  sharedRightX =  width / EDGE_SCALE;
  maxDist      =  width / 0.5;

  // scene/camera (unchanged)
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(
    -width / 2,  width / 2,
     height / 2, -height / 2,
     1, 1000
  );
  camera.position.z = 1;

  // renderer — keep transparent look you had
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,                 // keep translucent white you set
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(DPR);
  renderer.setSize(width, height, true);   // CSS+buffer sync
  renderer.setClearColor(0xffffff, 0.05);  // same subtle wash
  renderer.autoClear = true;

  // material — only change: blending → NormalBlending (so black shows on iPad)
  const material = new THREE.PointsMaterial({
    color: 0x000000,
    size: 1.8,
    sizeAttenuation: true,       // keep your world-unit vibe
    transparent: true,
    opacity: 0.4,
    map: createCircleTexture(),
    alphaTest: 0.1,
    depthWrite: false,
    blending: THREE.NormalBlending
  });

  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const points = new THREE.Points(geometry, material.clone());
    points.userData.index = i;
    lines.push(points);
    scene.add(points);
  }

  // listeners (non-visual)
  window.addEventListener('resize', scheduleSafeResize, { passive: true });
  window.addEventListener('orientationchange', scheduleSafeResize, { passive: true });
  canvas.addEventListener('webglcontextlost', (e)=>{ e.preventDefault(); contextLost = true; }, false);
  canvas.addEventListener('webglcontextrestored', ()=>{ contextLost = false; renderer.setPixelRatio(DPR); renderer.setSize(width, height, true); }, false);

  requestAnimationFrame(animate);
}

function createCircleTexture(){
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,size,size);
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
  ctx.fillStyle = '#000';
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// debounce resize/orientation (non-visual)
function scheduleSafeResize(){
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  let tries = 0, maxTries = 12, lastW=0, lastH=0, lastDpr=0;
  const tick = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    if ((w===lastW && h===lastH && dpr===lastDpr) || tries>=maxTries) {
      applyResize(w,h,dpr);
    } else {
      lastW=w; lastH=h; lastDpr=dpr; tries++;
      resizeRaf = requestAnimationFrame(tick);
    }
  };
  resizeRaf = requestAnimationFrame(tick);
}

function applyResize(newW, newH, newDpr){
  width=newW; height=newH; DPR=newDpr;

  // keep exact same centering factor as init
  sharedLeftX  = -width / EDGE_SCALE;
  sharedRightX =  width / EDGE_SCALE;
  maxDist      =  width / 0.5;

  camera.left = -width/2;
  camera.right = width/2;
  camera.top = height/2;
  camera.bottom = -height/2;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(DPR);
  renderer.setSize(width, height, true);   // update CSS+buffer
}

function animate(time){
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
