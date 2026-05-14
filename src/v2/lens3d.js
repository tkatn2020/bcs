// 🅐 Three.js 3D progressive lens — a rotating lens-shaped surface with
// per-vertex colors driven by the wavefront cyl field. Customer can drag
// to rotate; grade/ADD changes morph the color distribution.

import * as THREE from 'three';
import { state, subscribe } from '../wavefront/state.js';
import { sampleUnwantedCyl, paletteSample, REFERENCE_CYL } from '../wavefront/helpers.js';
import { geomFor } from './geom.js?v=17';

export function mountLens3D(parent) {
  const stage = document.createElement('div');
  stage.className = 'lens3d-stage';
  stage.innerHTML = `
    <div class="lens3d-foot">
      <div class="lens3d-tip">↻ 드래그하여 회전</div>
      <div class="lens3d-legend">
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#323ca0"></span>선명</span>
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#bee36e"></span>경계</span>
        <span class="lens3d-legend-item"><span class="lens3d-legend-dot" style="background:#dc6e64"></span>왜곡</span>
      </div>
    </div>
  `;
  parent.appendChild(stage);

  const w = stage.clientWidth || 800;
  const h = stage.clientHeight || 450;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
  camera.position.set(0, 0.6, 4.5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  stage.insertBefore(renderer.domElement, stage.firstChild);

  // Soft lighting — instrument-like, not dramatic
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.3);
  rim.position.set(-3, -1, -2);
  scene.add(rim);

  // Lens — an asymmetric ellipse extruded into a slight convex shell.
  // We use a parametric grid mesh so we can color each vertex by cyl.
  const SEG_U = 60, SEG_V = 40;
  const LENS_RX = 1.25, LENS_RY = 0.85;
  const SHELL_DEPTH = 0.18;

  const geometry = new THREE.PlaneGeometry(2 * LENS_RX, 2 * LENS_RY, SEG_U, SEG_V);
  // Deform plane → convex shell with elliptical clip
  const posAttr = geometry.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const visMask = new Float32Array(posAttr.count);   // 1 inside ellipse, 0 outside
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const nx = x / LENS_RX, ny = y / LENS_RY;
    const r2 = nx * nx + ny * ny;
    const inEllipse = r2 <= 1.0;
    visMask[i] = inEllipse ? 1 : 0;
    // Convex curvature toward viewer (positive z) + slight rim tuck
    const z = inEllipse ? SHELL_DEPTH * (1 - r2) : -0.05;
    posAttr.setZ(i, z);
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: true,
  });

  const lens = new THREE.Mesh(geometry, material);
  lens.rotation.x = -0.10;
  scene.add(lens);

  // Outer rim — a thin tube around the ellipse for definition.
  const rimGeom = new THREE.TorusGeometry(1.0, 0.012, 8, 64);
  rimGeom.scale(LENS_RX, LENS_RY, 1);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4, metalness: 0.6 });
  const rimMesh = new THREE.Mesh(rimGeom, rimMat);
  rimMesh.rotation.x = -0.10;
  scene.add(rimMesh);

  // Compute and apply vertex colors from current geom.
  function updateColors(s) {
    const odGeom = geomFor(s, 'OD');
    // Sample cyl over lens plane — convert lens-NDC (-LENS_RX..LENS_RX) to mm.
    // Lens physical radius taken as 22mm.
    const LENS_MM = 22;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      // Map plane Y down → optic Y (yMm positive = below center)
      const xMm = (x / LENS_RX) * LENS_MM;
      const yMm = -(y / LENS_RY) * LENS_MM;
      if (!visMask[i]) {
        colors[i * 3 + 0] = 0; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
        continue;
      }
      const cyl = sampleUnwantedCyl(xMm, yMm, odGeom);
      const t = Math.min(1, cyl / REFERENCE_CYL);
      const tVis = Math.pow(t, 0.65);
      const rgb = paletteSample('iso', tVis);
      // Blend with white to brighten clear regions slightly
      const lighten = 1 - tVis * 0.6;
      colors[i * 3 + 0] = (rgb[0] / 255) * lighten + (1 - lighten) * 0.95;
      colors[i * 3 + 1] = (rgb[1] / 255) * lighten + (1 - lighten) * 0.97;
      colors[i * 3 + 2] = (rgb[2] / 255) * lighten + (1 - lighten) * 1.0;
    }
    geometry.attributes.color.needsUpdate = true;
  }
  updateColors(state);

  // Slow auto-rotate + interactive drag.
  let yaw = -0.15, pitch = 0.08;
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
    pitch = Math.max(-0.6, Math.min(0.6, pitch));
    lastX = t.clientX; lastY = t.clientY;
  }
  function onUp() { dragging = false; }
  renderer.domElement.addEventListener('mousedown', onDown);
  renderer.domElement.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);

  // Animation loop
  let alive = true;
  function loop() {
    if (!alive) return;
    if (!dragging) yaw += 0.0025;     // slow auto-spin
    lens.rotation.y = yaw;
    lens.rotation.x = -0.10 + pitch;
    rimMesh.rotation.y = yaw;
    rimMesh.rotation.x = -0.10 + pitch;
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
  // Hook to anisometropia state too:
  function applyAnisoTilt(s) {
    if (s.aniso3dEnabled) {
      const dGap = Math.min(3, Math.abs(s.od.sphere - s.os.sphere) +
                              Math.abs(s.od.cylinder - s.os.cylinder));
      lens.position.x = dGap * 0.04;
      rimMesh.position.x = dGap * 0.04;
    } else {
      lens.position.x = 0;
      rimMesh.position.x = 0;
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
      material.dispose();
      rimGeom.dispose();
      rimMat.dispose();
      unsub?.();
    },
  };
}
