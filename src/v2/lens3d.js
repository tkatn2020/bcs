// 🅐 Three.js 3D progressive lens v2 — zone-coded wavefront on a true
// elliptical disc.
//
// Design intent (per right-side "선명한 시야 종합 점수" panel):
//   - The lens itself is shaped: a TRUE ellipse (no rectangular plane).
//   - Each surface point is colored by which DISTANCE ZONE it serves
//     (distance / intermediate / near), tinted with the same palette the
//     score panel uses (--z-d blue / --z-i green / --z-n amber).
//   - Where unwanted cyl is LOW (corridor + zone centers), the color is
//     bright and saturated → "이 영역은 선명합니다".
//   - Where unwanted cyl is HIGH (periphery, Minkwitz zone), the color
//     desaturates and shifts toward a warm magenta-red → "왜곡 영역".
//   - The mesh is a custom triangulated disc with subtle convex curvature
//     so it reads as a real eyeglass lens (no floor box, no rim artifacts).
//
// The legend below now reads 원거리 · 중간거리 · 근거리 to match the
// right panel directly.

import * as THREE from 'three';
import { state, subscribe } from '../wavefront/state.js';
import { sampleUnwantedCyl, REFERENCE_CYL, smoothstep } from '../wavefront/helpers.js';
import { geomFor } from './geom.js?v=18';

// ── Palette ──────────────────────────────────────────────
// Matches the CSS tokens used in the right-side score panel.
const Z_D = [0x3B / 255, 0x82 / 255, 0xF6 / 255];     // distance · blue
const Z_I = [0x10 / 255, 0xB9 / 255, 0x81 / 255];     // intermediate · green
const Z_N = [0xF5 / 255, 0x9E / 255, 0x0B / 255];     // near · amber
const DISTORT = [0xB8 / 255, 0x3A / 255, 0x7C / 255]; // warm magenta — peripheral cyl

export function mountLens3D(parent) {
  const stage = document.createElement('div');
  stage.className = 'lens3d-stage';
  stage.innerHTML = `
    <div class="lens3d-foot">
      <div class="lens3d-tip">↻ 드래그하여 회전</div>
      <div class="lens3d-legend">
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#3B82F6"></span>원거리</span>
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#10B981"></span>중간</span>
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#F59E0B"></span>근거리</span>
        <span class="lens3d-legend-divider"></span>
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#B83A7C"></span>왜곡</span>
      </div>
    </div>
  `;
  parent.appendChild(stage);

  const w = stage.clientWidth || 800;
  const h = stage.clientHeight || 450;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);
  camera.position.set(0, 0.55, 5.0);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.insertBefore(renderer.domElement, stage.firstChild);

  // ── Lighting — premium "studio" rig ────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.32));
  // Key — slightly warm, from upper right
  const key = new THREE.DirectionalLight(0xffeed8, 0.85);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  // Fill — cool blue from upper-left, gives the lens a glass cast
  const fill = new THREE.DirectionalLight(0xa8c4ff, 0.45);
  fill.position.set(-3, 1.5, 2);
  scene.add(fill);
  // Rim — back-light to define the edge against dark stage
  const rim = new THREE.DirectionalLight(0xffffff, 0.55);
  rim.position.set(0, -2, -3);
  scene.add(rim);

  // ── Geometry — true elliptical disc with concentric ring tessellation ─
  // RX/RY = ellipse radii. SHELL_DEPTH = max z displacement at center
  // (gives a subtle convex shell — real lens silhouette).
  const LENS_RX = 1.30;
  const LENS_RY = 0.88;
  const SHELL_DEPTH = 0.16;
  const RADIAL_SEGS = 36;     // concentric rings
  const ANGULAR_SEGS = 72;    // points per ring
  const { geometry, sampleXY } = buildEllipseDiscGeometry(LENS_RX, LENS_RY, SHELL_DEPTH, RADIAL_SEGS, ANGULAR_SEGS);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.30,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });

  const lens = new THREE.Mesh(geometry, material);
  lens.rotation.x = -0.10;
  scene.add(lens);

  // ── Rim — polished metal hairline around the lens edge ────────
  // TorusGeometry default radius=1 minorRadius=tube. Scale to ellipse.
  const rimGeom = new THREE.TorusGeometry(1.0, 0.014, 12, 96);
  rimGeom.scale(LENS_RX, LENS_RY, 1);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xe6ecf3,
    roughness: 0.18,
    metalness: 0.85,
  });
  const rimMesh = new THREE.Mesh(rimGeom, rimMat);
  rimMesh.rotation.x = -0.10;
  rimMesh.position.z = 0.001;
  scene.add(rimMesh);

  // ── Back-face — a flat-tinted concave shell behind the front face so
  // the lens has volume when tilted, instead of looking like paper. ─────
  const backGeom = buildEllipseDiscGeometry(LENS_RX, LENS_RY, -SHELL_DEPTH * 0.45, RADIAL_SEGS, ANGULAR_SEGS).geometry;
  const backColors = backGeom.attributes.color.array;
  for (let i = 0; i < backColors.length; i += 3) {
    // Dim cool tint
    backColors[i + 0] = 0.18;
    backColors[i + 1] = 0.22;
    backColors[i + 2] = 0.30;
  }
  backGeom.attributes.color.needsUpdate = true;
  const backMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.10,
    side: THREE.DoubleSide,
  });
  const backMesh = new THREE.Mesh(backGeom, backMat);
  backMesh.rotation.x = -0.10;
  backMesh.position.z = -0.001;   // sit just behind front
  scene.add(backMesh);

  // ── Per-vertex color mapping ───────────────────────────────
  // sampleXY[i] = { xMm, yMm } in lens physical coords.
  const colorBuf = geometry.attributes.color.array;

  function updateColors(s) {
    const odGeom = geomFor(s, 'OD');
    for (let i = 0; i < sampleXY.length; i++) {
      const { xMm, yMm } = sampleXY[i];
      const cyl = sampleUnwantedCyl(xMm, yMm, odGeom);
      const [r, g, b] = zoneCodedColor(xMm, yMm, cyl);
      colorBuf[i * 3 + 0] = r;
      colorBuf[i * 3 + 1] = g;
      colorBuf[i * 3 + 2] = b;
    }
    geometry.attributes.color.needsUpdate = true;
  }
  updateColors(state);

  // ── Interaction — drag to rotate + slow auto-spin ─────────
  let yaw = -0.15, pitch = 0.06;
  let dragging = false;
  let lastX = 0, lastY = 0;
  function onDown(e) {
    dragging = true;
    const t = e.touches ? e.touches[0] : e;
    lastX = t.clientX; lastY = t.clientY;
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - lastX;
    const dy = t.clientY - lastY;
    yaw   += dx * 0.008;
    pitch += dy * 0.005;
    pitch = Math.max(-0.55, Math.min(0.55, pitch));
    lastX = t.clientX; lastY = t.clientY;
  }
  function onUp() { dragging = false; }
  renderer.domElement.addEventListener('mousedown', onDown);
  renderer.domElement.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);

  let alive = true;
  function loop() {
    if (!alive) return;
    if (!dragging) yaw += 0.0022;
    const rx = -0.10 + pitch;
    lens.rotation.set(rx, yaw, 0);
    rimMesh.rotation.set(rx, yaw, 0);
    backMesh.rotation.set(rx, yaw, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // Resize
  function onResize() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  // Anisometropia spatial offset
  function applyAnisoTilt(s) {
    if (s.aniso3dEnabled) {
      const dGap = Math.min(3, Math.abs(s.od.sphere - s.os.sphere) +
                              Math.abs(s.od.cylinder - s.os.cylinder));
      const tx = dGap * 0.04;
      lens.position.x = tx;
      rimMesh.position.x = tx;
      backMesh.position.x = tx;
    } else {
      lens.position.x = 0;
      rimMesh.position.x = 0;
      backMesh.position.x = 0;
    }
  }

  const unsub = subscribe(s => {
    updateColors(s);
    applyAnisoTilt(s);
  });

  return {
    el: stage,
    update: () => {},
    dispose: () => {
      alive = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      geometry.dispose();
      backGeom.dispose();
      material.dispose();
      backMat.dispose();
      rimGeom.dispose();
      rimMat.dispose();
      unsub?.();
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Build a triangulated elliptical disc:
//   - 1 center vertex at z = depth
//   - RADIAL_SEGS concentric rings, each ANGULAR_SEGS points around
//   - z decreases parabolically toward the rim (convex shell)
//   - Indices: center fan + concentric quad strips
//   - Returns { geometry, sampleXY } where sampleXY[i] = { xMm, yMm } in
//     LENS physical mm coords (lens half-width = 22mm).
// ─────────────────────────────────────────────────────────────
function buildEllipseDiscGeometry(rx, ry, depth, radialSegs, angularSegs) {
  const LENS_MM = 22;   // matches the helpers' lens coordinate system

  const positions = [];
  const colors = [];
  const indices = [];
  const sampleXY = [];

  // Center vertex
  positions.push(0, 0, depth);
  colors.push(0.6, 0.6, 0.6);
  sampleXY.push({ xMm: 0, yMm: 0 });

  // Ring vertices
  for (let r = 1; r <= radialSegs; r++) {
    const rNorm = r / radialSegs;
    for (let a = 0; a < angularSegs; a++) {
      const theta = (a / angularSegs) * Math.PI * 2;
      const x = Math.cos(theta) * rx * rNorm;
      const y = Math.sin(theta) * ry * rNorm;
      const z = depth * (1 - rNorm * rNorm);
      positions.push(x, y, z);
      colors.push(0.6, 0.6, 0.6);
      const xMm = (x / rx) * LENS_MM;
      const yMm = -(y / ry) * LENS_MM;  // flip y → optic Y (positive = below center)
      sampleXY.push({ xMm, yMm });
    }
  }

  // Indices — center fan (ring 1)
  for (let a = 0; a < angularSegs; a++) {
    const next = (a + 1) % angularSegs;
    indices.push(0, 1 + a, 1 + next);
  }
  // Indices — ring strips
  for (let r = 0; r < radialSegs - 1; r++) {
    const innerStart = 1 + r * angularSegs;
    const outerStart = 1 + (r + 1) * angularSegs;
    for (let a = 0; a < angularSegs; a++) {
      const next = (a + 1) % angularSegs;
      const i00 = innerStart + a;
      const i01 = innerStart + next;
      const i10 = outerStart + a;
      const i11 = outerStart + next;
      indices.push(i00, i10, i11);
      indices.push(i00, i11, i01);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return { geometry: geom, sampleXY };
}

// ─────────────────────────────────────────────────────────────
// Zone-coded color: blend zone-base colors by gaze height, modulate
// brightness by clarity, fade toward magenta as cyl rises.
// ─────────────────────────────────────────────────────────────
function zoneCodedColor(xMm, yMm, cyl) {
  // Zone weight (same model as helpers.computeClearRatios)
  const yNorm = yMm / 11;
  const wDist = smoothstep(0.0, -0.6, yNorm);
  const wNear = smoothstep(0.6, 1.4, yNorm);
  const wCorr = Math.max(0, 1 - wDist - wNear);

  // Base zone tint
  const baseR = Z_D[0] * wDist + Z_I[0] * wCorr + Z_N[0] * wNear;
  const baseG = Z_D[1] * wDist + Z_I[1] * wCorr + Z_N[1] * wNear;
  const baseB = Z_D[2] * wDist + Z_I[2] * wCorr + Z_N[2] * wNear;

  // Clarity: 1 at clean center, 0 at peak peripheral cyl.
  // Perceptual curve so heavy-cyl regions desaturate aggressively.
  const t = Math.min(1, cyl / REFERENCE_CYL);
  const distort = Math.pow(t, 0.55);
  const clarity = 1 - distort;

  // Distortion target — warm magenta. Blend in toward periphery.
  const mixR = baseR * clarity + DISTORT[0] * distort;
  const mixG = baseG * clarity + DISTORT[1] * distort;
  const mixB = baseB * clarity + DISTORT[2] * distort;

  // Soft luminance boost at peak clarity so corridor + zone centers
  // visually pop (this matches the "선명도 지수" hero brightness).
  const lift = 0.18 * clarity;
  return [
    Math.min(1, mixR + lift),
    Math.min(1, mixG + lift),
    Math.min(1, mixB + lift),
  ];
}
