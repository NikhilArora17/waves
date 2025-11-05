import * as THREE from 'three';
import { Noise } from 'noisejs';

const noise = new Noise();

let scene, camera, renderer;
const lines = [];
let lineCount = 25;

// dots along each curve are spaced by this many pixels
let dotSpacing = 7;

let width = window.innerWidth;
let height = window.innerHeight;

let sharedLeftX = -width / 1.3;
let sharedRightX =  width / 1.3;
let maxDist = width / 0.5;

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
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });

  // iOS performance & stability
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height);
  renderer.setClearColor(0xffffff, 0.05); // soft white wash

  // MATERIAL: use normal blending so black dots are actually visible
  const material = new THREE.PointsMaterial({
    color: 0x000000,
    size: 1.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.45,
    map: createCircleTexture(),
    alphaTest: 0.02,
    depthWrite: false,
    blending: THREE.NormalBlending   // <- changed from Additive
  });

  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); // placeholder
    const points = new THREE.Points(geometry, material.clone());
    points.userData.index = i;
    lines.push(points);
    scene.add(points);
  }

  // Robust resize/orientation handling for iPad
  window.addEventListener('resize', debounce(onResize, 80), { passive: true });
  window.addEventListener('orientationchange', () => {
    // iOS can report stale innerWidth/innerHeight for a moment; delay resize a tick
    setTimeout(onResize, 120);
  });

  // Handle potential WebGL context loss on iPad rotation
  const gl = renderer.getContext();
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    onResize(); // rebuild sizes/buffers when context comes back
  }, false);
}

function createCircleTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Feathered round sprite (looks smooth on iPad)
  const r = size * 0.5;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0.0, 'rgba(0,0,0,1)');
  g.addColorStop(0.7, 'rgba(0,0,0,1)');
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 1;
  return texture;
}

function onResize() {
  width = window.innerWidth;
  height = window.innerHeight;

  sharedLeftX  = -width / 1.3;
  sharedRightX =  width / 1.3;
  maxDist      =  width / 0.5;

  camera.left   = -width / 2;
  camera.right  =  width / 2;
  camera.top    =  height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);
}

function animate(time = 0) {
  requestAnimationFrame(animate);
  const t = time * 0.00032;

  // clear the frame (correct API; avoids the bad call that crashes Safari)
  renderer.clear();

  lines.forEach((points, lineIndex) => {
    const baseY = 0;
    const amplitude = 150 + lineIndex * 30;
    const phaseShift = lineIndex * 0.2;

    const verticalOffset   = Math.sin(t * 2   + phaseShift) * 12;
    const horizontalJitter = Math.sin(t * 1.5 + phaseShift) * 5;

    const p0 = new THREE.Vector3(sharedLeftX  + horizontalJitter, baseY + verticalOffset, 0);
    const p4 = new THREE.Vector3(sharedRightX + horizontalJitter, baseY + verticalOffset, 0);

    const midPoints = [];
    for (let j = 0; j < 3; j++) {
      const x = sharedLeftX + ((j + 1) / 4) * (sharedRightX - sharedLeftX) + horizontalJitter;
      const y = baseY + verticalOffset + noise.perlin2(j * (0.4 + lineIndex * 0.05), t + lineIndex * 0.07) * amplitude;
      midPoints.push(new THREE.Vector3(x, y, 0));
    }

    const curve = new THREE.CatmullRomCurve3([p0, ...midPoints, p4]);

    // points along the curve, spaced ~dotSpacing pixels
    const curveLength = curve.getLength();
    const pointCount  = Math.max(2, Math.floor(curveLength / dotSpacing));
    const curvePoints = curve.getSpacedPoints(pointCount);

    // grow/shrink buffer if needed
    if (points.geometry.attributes.position.count !== curvePoints.length) {
      points.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(curvePoints.length * 3), 3)
      );
    }

    const positions = points.geometry.attributes.position.array;
    for (let i = 0; i < curvePoints.length; i++) {
      const p = curvePoints[i];
      const idx = i * 3;
      positions[idx]     = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = 0;
    }
    points.geometry.attributes.position.needsUpdate = true;

    // soft center fade
    const centerIndex = Math.floor(curvePoints.length / 2);
    const cx = curvePoints[centerIndex].x;
    const distToCenter = Math.abs(cx);
    const fade = 1.0 - Math.min(distToCenter / maxDist, 1);

    // gentle breathing opacity; clamp for iPad banding
    const baseOpacity = 0.18;
    const pulse = 0.28 * Math.sin(t * 4 + lineIndex * 0.4) * fade;
    points.material.opacity = Math.min(0.65, Math.max(0.08, baseOpacity + pulse));
  });

  renderer.render(scene, camera);
}

// tiny debounce helper (iOS fires many resize events)
function debounce(fn, ms = 100) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
