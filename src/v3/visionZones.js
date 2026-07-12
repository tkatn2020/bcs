// v3 Vision zones — translucent per-eye cones from the pupil anchors.
// Additive blending: where left/right cones overlap, brightness doubles —
// the binocular overlap reads for free (PRD §6.3c). Zone spec morphs are
// tweened (300ms) so grade/ADD changes breathe instead of snapping.
//
// Cone geometry: unit cone, apex at origin, axis along -y (then oriented by
// quaternion). Per-axis scale = (tan(hHalf)·len, len, tan(vHalf)·len) gives
// an elliptic cross-section — horizontal FOV ≠ vertical FOV.

import * as THREE from 'three';

export const ZONE_COLORS = {
  distance: 0x3b82f6,
  intermediate: 0x22c55e,
  near: 0xf59e0b,
};

const ZONES = ['distance', 'intermediate', 'near'];
const MORPH_MS = 300;
const DOWN = new THREE.Vector3(0, -1, 0);

function unitConeGeometry() {
  const geo = new THREE.ConeGeometry(1, 1, 48, 1, true);
  geo.translate(0, -0.5, 0);   // apex at origin, base at (0,-1,0)
  return geo;
}

export function createVisionZones(anchors) {
  const group = new THREE.Group();
  group.name = 'visionZones';
  const geo = unitConeGeometry();

  // cones[zone] = [meshL, meshR]
  const cones = {};
  const zoneMats = {};
  for (const zone of ZONES) {
    const mat = new THREE.MeshBasicMaterial({
      color: ZONE_COLORS[zone],
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    zoneMats[zone] = mat;
    cones[zone] = [anchors.left, anchors.right].map((anchor) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.base = anchor.position.clone();   // pupil origin
      mesh.renderOrder = 10;
      group.add(mesh);
      return mesh;
    });
  }

  // Ghost cones (D6 등급 비교 잔상) — white outline of the PREVIOUS grade's
  // zones, fading out while the live cones morph to the new grade.
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const ghostCones = {};
  for (const zone of ZONES) {
    ghostCones[zone] = [anchors.left, anchors.right].map((anchor) => {
      const mesh = new THREE.Mesh(geo, ghostMat);
      mesh.userData.base = anchor.position.clone();
      mesh.renderOrder = 9;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    });
  }

  // displayed = what's on screen right now (tween interpolates displayed → target)
  let displayed = null;
  let from = null;
  let target = null;
  let tweenStart = 0;
  let raf = 0;

  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  function applySpecTo(coneSet, spec) {
    const yawRad = THREE.MathUtils.degToRad(spec.eyeYawDeg || 0);
    for (const zone of ZONES) {
      const z = spec[zone];
      const pitchRad = THREE.MathUtils.degToRad(z.pitch);
      const baseDir = new THREE.Vector3(0, Math.sin(pitchRad), Math.cos(pitchRad)).normalize();
      const sx = Math.tan(THREE.MathUtils.degToRad(z.h)) * z.len;
      const sz = Math.tan(THREE.MathUtils.degToRad(z.v)) * z.len;
      coneSet[zone].forEach((mesh, i) => {
        // PD error: eyes diverge outward (left −yaw, right +yaw) → the
        // additive overlap between L/R cones visibly shrinks.
        const dir = baseDir.clone().applyAxisAngle(Y_AXIS, i === 0 ? -yawRad : yawRad);
        mesh.quaternion.setFromUnitVectors(DOWN, dir);
        mesh.scale.set(sx, z.len, sz);
        // Apex starts just past the lens plane — the "field through the lens"
        // story, and keeps additive cones from washing out the face/chin.
        mesh.position.copy(mesh.userData.base).addScaledVector(dir, 0.045);
      });
    }
  }

  function applySpec(spec) {
    displayed = spec;
    applySpecTo(cones, spec);
  }

  function lerpSpec(a, b, t) {
    const out = {
      eyeYawDeg: (a.eyeYawDeg || 0) + ((b.eyeYawDeg || 0) - (a.eyeYawDeg || 0)) * t,
    };
    for (const zone of ZONES) {
      out[zone] = {
        h: a[zone].h + (b[zone].h - a[zone].h) * t,
        v: a[zone].v + (b[zone].v - a[zone].v) * t,
        pitch: a[zone].pitch + (b[zone].pitch - a[zone].pitch) * t,
        len: a[zone].len + (b[zone].len - a[zone].len) * t,
      };
    }
    return out;
  }

  function tick(ts) {
    const t = Math.min(1, (ts - tweenStart) / MORPH_MS);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    applySpec(lerpSpec(from, target, eased));
    if (t < 1) raf = requestAnimationFrame(tick);
    else raf = 0;
  }

  function update(spec, animate = true) {
    if (!animate || !displayed) {
      applySpec(spec);
      return;
    }
    from = displayed;          // tween from whatever is currently on screen
    target = spec;
    tweenStart = performance.now();
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function setVisible(zone, visible) {
    for (const mesh of cones[zone]) mesh.visible = visible;
  }

  // 데모용 존 강조 (D4): 지목한 존은 밝게, 나머지는 흐리게. null = 원상복귀.
  function setEmphasis(zone) {
    for (const z of ZONES) {
      zoneMats[z].opacity = zone == null ? 0.11 : (z === zone ? 0.26 : 0.04);
    }
  }

  // 등급 고스트 (D6): 이전 등급의 존을 흰색 잔상으로 띄우고 1.1s 페이드아웃.
  let ghostRaf = 0;
  function showGhost(spec) {
    if (!spec) return;
    applySpecTo(ghostCones, spec);
    for (const z of ZONES) for (const m of ghostCones[z]) m.visible = true;
    const t0 = performance.now();
    if (ghostRaf) cancelAnimationFrame(ghostRaf);
    (function fade(ts) {
      const t = Math.min(1, (ts - t0) / 1100);
      ghostMat.opacity = 0.045 * (1 - t);   // 은은한 잔상 — additive 중첩 고려
      if (t < 1) ghostRaf = requestAnimationFrame(fade);
      else {
        ghostRaf = 0;
        for (const z of ZONES) for (const m of ghostCones[z]) m.visible = false;
      }
    })(t0);
  }

  function dispose() {
    if (raf) cancelAnimationFrame(raf);
    if (ghostRaf) cancelAnimationFrame(ghostRaf);
    geo.dispose();
    ghostMat.dispose();
    for (const zone of ZONES) cones[zone][0].material.dispose();
  }

  return { group, update, setVisible, setEmphasis, showGhost, dispose };
}
