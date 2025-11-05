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
    // CHANGED: make canvas opaque to avoid iOS alpha + clear issues
    alpha: false
  });
  renderer.setSize(width, height);
  // CHANGED: clamp DPR for stability on iPad/retina
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // CHANGED: use opaque clear (no semi-transparent background)
  renderer.setClearColor(0xffffff, 1);

  // CHANGED: NormalBlending so black points are visible (not additive black)
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

  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(3); // placeholder, real size set each frame
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, material.clone());
    points.userData.index = i;
    lines.push(points);
    scene.add(points);
  }

  // CHANGED: stable resize handler (immediate + next frame) for iPad rotation
  const onWindowResizeStable = () => {
    onWindowResize();
    requestAnimationFrame(onWindowResize);
  };
  window.addEventListener('resize', onWindowResizeStable, { passive: true });
  window.addEventListener('orientationchange', onWindowResizeStable, { passive: true });
}

function createCircleTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // keep the same hard-edged dot (no visual change on desktop)
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function onWindowResize() {
  width = window.innerWidth;
  height = window.innerHeight;

  sharedLeftX = -width / 1.5;
  sharedRightX = width / 1.5;
  maxDist = width / 0.5;

  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

function animate(time) {
  requestAnimationFrame(animate);
  const t = time * 0.00032;

  // REMOVED: renderer.clearColor(); (this call doesn't exist and caused issues)

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
      let x = sharedLeftX + ((j + 1) / 4) * (sharedRightX - sharedLeftX) + horizontalJitter;
      let y = baseY + verticalOffset + noise.perlin2(j * (0.4 + lineIndex * 0.05), t + lineIndex * 0.07) * amplitude;
      midPoints.push(new THREE.Vector3(x, y, 0));
    }

    const curve = new THREE.CatmullRomCurve3([p0, ...midPoints, p4]);

    // calculate number of dots based on curve length and spacing
    const curveLength = curve.getLength();
    const pointCount = Math.floor(curveLength / dotSpacing);

    const curvePoints = curve.getSpacedPoints(pointCount);

    // resize buffer if needed
    if (points.geometry.attributes.position.count !== curvePoints.length) {
      points.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(curvePoints.length * 3), 3)
      );
    }

    const positions = points.geometry.attributes.position.array;

    for (let j = 0; j < curvePoints.length; j++) {
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

// tiny debounce helper (unused but kept)
function debounce(fn, ms = 100) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
