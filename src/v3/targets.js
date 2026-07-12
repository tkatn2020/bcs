// v3 Targets (PRD §7 D3) — 원거리 스크린 · 모니터(65cm) · 책(40cm) placed in
// WORLD space at each zone's real working distance/declination. Each carries
// a judgment ring: green = the zone cone reaches & covers it, red = missed
// (e.g., OH dragged low → near cone no longer lands on the book — the S1
// teaching moment).

import * as THREE from 'three';
import { ZONE_COLORS } from './visionZones.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const DEFS = [
  {
    key: 'far', zone: 'distance', label: '원거리',
    pos: new THREE.Vector3(0, -0.05, 1.45), size: [0.52, 0.30], tilt: 0,
  },
  {
    key: 'monitor', zone: 'intermediate', label: '모니터 65cm',
    pos: new THREE.Vector3(0, -0.175, 0.64), size: [0.24, 0.155], tilt: -0.08,
  },
  {
    key: 'book', zone: 'near', label: '책 40cm',
    pos: new THREE.Vector3(0, -0.26, 0.36), size: [0.20, 0.14], tilt: -1.05,
  },
];

export function createTargets(scene) {
  const group = new THREE.Group();
  group.name = 'targets';
  group.visible = false;
  scene.add(group);

  const items = DEFS.map((def) => {
    const holder = new THREE.Group();
    holder.position.copy(def.pos);
    holder.rotation.x = def.tilt;
    group.add(holder);

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(def.size[0], def.size[1]),
      new THREE.MeshBasicMaterial({
        color: 0x2a2f3a, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      }),
    );
    holder.add(panel);

    // Judgment ring around the panel
    const ringR = Math.hypot(def.size[0], def.size[1]) * 0.62;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringR * 0.92, ringR, 48),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      }),
    );
    holder.add(ring);

    // Label sprite
    const label = makeLabel(def.label, ZONE_COLORS[def.zone]);
    label.position.set(0, def.size[1] * 0.5 + 0.045, 0.001);
    holder.add(label);

    return { def, holder, ring };
  });

  function makeLabel(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 112;
    const ctx = c.getContext('2d');
    ctx.font = '700 58px Pretendard, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 256, 56);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.20, 0.044, 1);
    return sprite;
  }

  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  // Reach judgment: target center inside the zone cone (angle + distance)?
  function update(spec, mannequinGroup, anchors) {
    if (!group.visible || !spec) return;
    mannequinGroup.updateMatrixWorld(true);
    const mid = new THREE.Vector3()
      .addVectors(anchors.left.position, anchors.right.position)
      .multiplyScalar(0.5);
    const pupil = mannequinGroup.localToWorld(mid.clone());

    for (const { def, ring } of items) {
      const z = spec[def.zone];
      const pitchRad = THREE.MathUtils.degToRad(z.pitch);
      const dir = new THREE.Vector3(0, Math.sin(pitchRad), Math.cos(pitchRad))
        .applyQuaternion(mannequinGroup.quaternion)
        .normalize();
      const toTarget = def.pos.clone().sub(pupil);
      const dist = toTarget.length();
      const angleDeg = THREE.MathUtils.radToDeg(dir.angleTo(toTarget.normalize()));
      // Elliptic mean half-angle + tight distance margin — calibrated so the
      // standard fit passes all three targets while the '잘못된 피팅' preset
      // visibly loses the book (S1 teaching moment).
      const reach = angleDeg <= (z.h + z.v) / 2 && dist <= z.len * 1.05;
      ring.material.color.set(reach ? 0x22c55e : 0xef4444);
    }
  }

  function setVisible(v) {
    group.visible = v;
  }

  return { group, update, setVisible };
}
