// v3 Studio stage — scene, studio lighting, camera presets, orbit controls.
// Full-viewport responsive (no fixed 1280×800 scaling — see PRD §5.1).
// Lighting rig tuned for the glossy-white mannequin look (PRD §6.2):
// RoomEnvironment IBL carries the clearcoat highlights, 3-point rig shapes them.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createStudioStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Temporary dark-studio background — final palette decided during build
  // (design file dropped; PRD §4). Dark base keeps additive vision cones viable.
  scene.background = new THREE.Color(0x171a20);

  // IBL — procedural room environment (no texture downloads; PRD §9.3).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  camera.position.set(0.28, 0.04, 0.62);

  // Studio 3-point rig
  const key = new THREE.DirectionalLight(0xfff4e8, 1.5);
  key.position.set(1.2, 1.4, 1.0);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.45);
  fill.position.set(-1.4, 0.3, 0.8);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-0.4, 0.9, -1.4);
  scene.add(key, fill, rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // 자유 시점 이동(pan) 허용 — 데스크톱: 마우스 우클릭 드래그, 터치: 두 손가락 드래그.
  // 제스처 분리로 겹침 방지: 한 손가락=회전(시점 각도), 두 손가락=이동+줌.
  controls.enablePan = true;
  controls.screenSpacePanning = true;   // 화면 평면 기준 이동(직관적 자유 이동)
  controls.minDistance = 0.3;
  controls.maxDistance = 1.6;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.maxPolarAngle = Math.PI * 0.74;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(0, 0, 0);

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let alive = true;
  (function loop() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  function dispose() {
    alive = false;
    window.removeEventListener('resize', resize);
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { scene, camera, renderer, controls, dispose };
}
